import type { FastifyInstance } from 'fastify';
import { ghExec, GhCliError } from '../lib/ghExec.js';
import { LRUCache } from '../lib/lruCache.js';
import { BadParamsError, parsePullParams } from '../lib/parseRouteParams.js';
import { extractBuildkiteCheckUrl, detectTrunkInQueue, flattenCiContexts, countCiContexts } from '../lib/ciUrl.js';
import { PULL_REQUEST_QUERY } from '../queries/pullRequest.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_MUTATION } from '../queries/addPullRequestReview.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_THREAD_MUTATION } from '../queries/addPullRequestReviewThread.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_THREAD_REPLY_MUTATION } from '../queries/addPullRequestReviewThreadReply.graphql.js';
import { SUBMIT_PULL_REQUEST_REVIEW_MUTATION } from '../queries/submitPullRequestReview.graphql.js';
import { MARK_READY_FOR_REVIEW_MUTATION } from '../queries/markReadyForReview.graphql.js';
import { CLOSE_PULL_REQUEST_MUTATION } from '../queries/closePullRequest.graphql.js';
import { claudeExec, ClaudeCliError } from '../lib/claudeExec.js';
import { gitExec, GitCliError } from '../lib/gitExec.js';
import { getFixCiPrompt } from '../prompts/index.js';
import { FIX_CI_PROMPT_VERSION, emitFixCiEvent } from '../lib/fixCiTelemetry.js';
import { randomUUID } from 'node:crypto';
import { ENABLE_AUTO_MERGE_MUTATION, DISABLE_AUTO_MERGE_MUTATION } from '../queries/autoMerge.graphql.js';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

type CiStatus = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;

interface PullRequestMeta {
  id: string;
  number: number;
  title: string;
  authorLogin: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  isDraft: boolean;
  /** GitHub's MergeableState — `CONFLICTING` means the PR has unresolved
   * merge conflicts. `UNKNOWN` is the transient "not yet computed" state
   * and is rendered as "no conflict" client-side. */
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN' | null;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  ciStatus: CiStatus;
  /** URL of the buildkite/zenpayroll check, if it exists on this PR. */
  ciUrl: string | null;
  /** Every status-check-rollup context for the PR's head commit, flattened
   * into a uniform shape. Powers the "Fix failing CI" flow — Claude needs
   * the failing check names + their detail URLs to know what to reproduce
   * locally. `isFailure` is true for any non-success terminal state. */
  ciContexts: Array<{ name: string; state: string | null; url: string | null; isFailure: boolean }>;
  /** Pass / total counters across the rollup contexts. Powers the row's
   * GitHub-style "✓ N/M" badge. Passed = SUCCESS / NEUTRAL / SKIPPED. */
  ciCounts: { passed: number; total: number };
  /** GitHub logins whose LATEST review on this PR is APPROVED. Used to
   * surface "Approved by alice, bob" in the green-check tooltip. */
  approvers: string[];
  baseRefName: string;
  headRefName: string;
  headSha: string;
  url: string;
  createdAt: string | null;
  /** Pre-rendered GitHub-flavored markdown HTML for the PR body. */
  bodyHtml: string | null;
  /** If the viewer has a pending (in-progress) review on this PR, its id. */
  viewerPendingReviewId: string | null;
  labels: PRLabel[];
  assignees: PRAssignee[];
  reviews: ReviewSummary[];
  /** Top-level PR conversation comments (issue-style, not diff-anchored). */
  comments: PrComment[];
  reviewThreads: ReviewThread[];
  /** Auto-merge ("merge when ready") state. null when not enabled. */
  autoMergeRequest: { mergeMethod: 'MERGE' | 'SQUASH' | 'REBASE'; enabledBy: string | null; enabledAt: string | null } | null;
  /** Whether the viewer can flip auto-merge on. False for un-mergeable PRs
   * (already merged, conflicts, or org/repo policy). */
  viewerCanEnableAutoMerge: boolean;
  /** Merge-queue entry — non-null when the PR is in the queue. Distinct from
   * `autoMergeRequest`: a PR can have auto-merge enabled but not yet have
   * been accepted into the queue. */
  mergeQueueEntry: { position: number | null; state: string | null } | null;
  /** True when the PR has an active Trunk merge-queue check run (status is
   * QUEUED or IN_PROGRESS, name starts with "trunk"). Trunk surfaces queue
   * state via a check run rather than GitHub's mergeQueueEntry, so this is
   * the authoritative "in queue" signal for Trunk-managed repos. False
   * (always) for repos that don't use Trunk. */
  trunkInQueue: boolean;
}

interface PRLabel { name: string; color: string; }
interface PRAssignee { login: string; avatarUrl: string | null; url: string | null; }
interface ReviewSummary {
  id: string;
  state: 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'PENDING';
  body: string;
  bodyHtml: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  createdAt: string;
  url: string;
}

interface PrComment {
  id: string;
  bodyHtml: string;
  createdAt: string;
  url: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  authorUrl: string | null;
}

interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  comments: Array<{ id: string; authorLogin: string | null; authorAvatarUrl: string | null; body: string; bodyHtml: string; createdAt: string; diffHunk: string | null }>;
}

interface CreateReviewBody {
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT' | 'PENDING';
  body?: string;
  threads?: Array<{
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    body: string;
    startLine?: number;
    startSide?: 'LEFT' | 'RIGHT';
  }>;
}

interface CreateThreadBody {
  path: string;
  body: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  pullRequestReviewId?: string;
}

interface SubmitReviewBody {
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body?: string;
}

function toThreadVariable(c: {
  path: string;
  body: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
}): Record<string, string | number> {
  const t: Record<string, string | number> = { path: c.path, body: c.body, line: c.line, side: c.side };
  if (c.startLine != null && c.startLine !== c.line) {
    t.startLine = c.startLine;
    t.startSide = c.startSide ?? c.side;
  }
  return t;
}

interface GraphQLError {
  message?: string;
  type?: string;
  path?: Array<string | number>;
  locations?: Array<{ line: number; column: number }>;
  extensions?: Record<string, unknown>;
}
interface GraphQLResp<T> {
  data?: T;
  errors?: GraphQLError[];
}

/** When a GraphQL mutation returns `data.<root>: null` we need to surface what
 * GitHub actually said so the user (and us) can debug. GitHub sometimes returns
 * `data: null, errors: [...]`, sometimes `data: { x: null }, errors: [...]`,
 * occasionally just `data: { x: null }` with no errors at all. This helper
 * builds the richest message it can from whatever's present in the response,
 * and logs the raw payload to the server console for the silent cases. */
function graphqlReturnedNullError(
  what: string,
  rawResponse: string,
  parsed: GraphQLResp<unknown>,
  extra?: { variables?: Record<string, unknown> },
): Error {
  const errs = parsed.errors ?? [];
  if (errs.length > 0) {
    const lines = errs.map((e) => {
      const path = e.path ? ` (at ${e.path.join('.')})` : '';
      const type = e.type ? ` [${e.type}]` : '';
      return `${e.message ?? '<no message>'}${type}${path}`;
    });
    return new Error(`${what} failed: ${lines.join('; ')}`);
  }
  // No GraphQL errors but no payload either — log the raw response so we can
  // see what GitHub actually returned, and include a snippet in the user-facing
  // error.
  // eslint-disable-next-line no-console
  console.warn(`[${what}] returned no review and no errors. Raw response:`, rawResponse.slice(0, 4000), 'extra:', extra);
  const snippet = rawResponse.length > 600 ? rawResponse.slice(0, 600) + '…' : rawResponse;
  const variablesNote = extra?.variables ? ` (variables: ${JSON.stringify(extra.variables)})` : '';
  return new Error(`${what} returned no review and no errors${variablesNote}. Raw GitHub response: ${snippet}`);
}

function metaKey(p: { owner: string; repo: string; number: number }) {
  return `${p.owner}/${p.repo}#${p.number}`;
}
function diffKey(p: { owner: string; repo: string; number: number; headSha: string }) {
  return `${p.owner}/${p.repo}#${p.number}@${p.headSha}`;
}

async function fetchMeta(owner: string, repo: string, number: number): Promise<PullRequestMeta> {
  const stdout = await ghExec([
    'api',
    'graphql',
    '-f', `query=${PULL_REQUEST_QUERY}`,
    '-F', `owner=${owner}`,
    '-F', `repo=${repo}`,
    '-F', `number=${number}`,
  ]);
  const data = JSON.parse(stdout);
  const pr = data?.data?.repository?.pullRequest;
  if (!pr) throw new Error('PR not found in GraphQL response');
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    authorLogin: pr.author?.login ?? null,
    state: pr.state,
    merged: pr.merged,
    isDraft: !!pr.isDraft,
    mergeable: pr.mergeable ?? null,
    reviewDecision: pr.reviewDecision ?? null,
    ciStatus: (pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null) as CiStatus,
    ciUrl: extractBuildkiteCheckUrl(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
    ciContexts: flattenCiContexts(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
    ciCounts: countCiContexts(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
    approvers: (pr.latestReviews?.nodes ?? [])
      .filter((r: { state?: string; author?: { login?: string } }) => r?.state === 'APPROVED' && r.author?.login)
      .map((r: { author?: { login?: string } }) => r.author!.login!),
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headSha: pr.headRefOid,
    url: pr.url,
    createdAt: pr.createdAt ?? null,
    bodyHtml: pr.bodyHTML ?? null,
    viewerPendingReviewId: pr.viewerLatestReview?.state === 'PENDING' ? (pr.viewerLatestReview?.id ?? null) : null,
    labels: (pr.labels?.nodes ?? []).map((l: { name?: string; color?: string }) => ({
      name: l.name ?? '',
      color: l.color ?? '888888',
    })).filter((l: PRLabel) => l.name),
    assignees: (pr.assignees?.nodes ?? []).map((a: { login?: string; avatarUrl?: string; url?: string }) => ({
      login: a.login ?? '',
      avatarUrl: a.avatarUrl ?? null,
      url: a.url ?? null,
    })).filter((a: PRAssignee) => a.login),
    reviews: (pr.reviews?.nodes ?? [])
      .map((r: { id: string; state: ReviewSummary['state']; body?: string; bodyHTML?: string; author?: { login?: string; avatarUrl?: string }; createdAt?: string; url?: string }) => ({
        id: r.id,
        state: r.state,
        body: r.body ?? '',
        bodyHtml: r.bodyHTML ?? '',
        authorLogin: r.author?.login ?? null,
        authorAvatarUrl: r.author?.avatarUrl ?? null,
        createdAt: r.createdAt ?? '',
        url: r.url ?? '',
      } satisfies ReviewSummary))
      // Drop pending drafts, empty bodies, and bot accounts (login ends in [bot]).
      .filter((r: ReviewSummary) => r.state !== 'PENDING' && r.body.trim().length > 0 && !(r.authorLogin ?? '').endsWith('[bot]')),
    comments: (pr.comments?.nodes ?? [])
      .map((c: { id: string; bodyHTML?: string; createdAt: string; url?: string; author?: { login?: string; avatarUrl?: string; url?: string } }) => ({
        id: c.id,
        bodyHtml: c.bodyHTML ?? '',
        createdAt: c.createdAt,
        url: c.url ?? null,
        authorLogin: c.author?.login ?? null,
        authorAvatarUrl: c.author?.avatarUrl ?? null,
        authorUrl: c.author?.url ?? null,
      } satisfies PrComment))
      // Drop bot comments (auto-labeling, CI, etc.) that would clutter the
      // conversation with noise.
      .filter((c: PrComment) => !(c.authorLogin ?? '').endsWith('[bot]')),
    reviewThreads: (pr.reviewThreads?.nodes ?? []).map((t: {
      id: string;
      isResolved: boolean;
      isOutdated?: boolean;
      path: string;
      line: number | null;
      comments?: {
        nodes?: Array<{
          id: string;
          author?: { login?: string; avatarUrl?: string };
          body: string;
          bodyHTML?: string;
          createdAt: string;
          diffHunk?: string;
        }>;
      };
    }) => ({
      id: t.id,
      isResolved: t.isResolved,
      isOutdated: !!t.isOutdated,
      path: t.path,
      line: t.line,
      comments: (t.comments?.nodes ?? []).map((c) => ({
        id: c.id,
        authorLogin: c.author?.login ?? null,
        authorAvatarUrl: c.author?.avatarUrl ?? null,
        body: c.body,
        bodyHtml: c.bodyHTML ?? '',
        createdAt: c.createdAt,
        diffHunk: c.diffHunk ?? null,
      })),
    })),
    autoMergeRequest: pr.autoMergeRequest
      ? {
          mergeMethod: pr.autoMergeRequest.mergeMethod ?? 'SQUASH',
          enabledBy: pr.autoMergeRequest.enabledBy?.login ?? null,
          enabledAt: pr.autoMergeRequest.enabledAt ?? null,
        }
      : null,
    viewerCanEnableAutoMerge: !!pr.viewerCanEnableAutoMerge,
    mergeQueueEntry: pr.mergeQueueEntry
      ? {
          position: typeof pr.mergeQueueEntry.position === 'number' ? pr.mergeQueueEntry.position : null,
          state: pr.mergeQueueEntry.state ?? null,
        }
      : null,
    trunkInQueue: detectTrunkInQueue(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
  };
}

export async function registerPullsRoutes(app: FastifyInstance) {
  // Caches are scoped to this server instance so tests get fresh state per buildServer().
  const metaCache = new LRUCache<string, PullRequestMeta>(20);
  const diffCache = new LRUCache<string, string>(20);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof BadParamsError) {
      reply.code(400).send({ code: 'BAD_PARAMS', message: err.message });
      return;
    }
    if (err instanceof GhCliError) {
      const status = err.code === 'AUTH_REQUIRED' ? 401
        : err.code === 'RATE_LIMITED' ? 429
        : err.code === 'GH_API_ERROR' ? 502
        : 500;
      reply.code(status).send({ code: err.code, message: err.message, stderr: err.stderr });
      return;
    }
    reply.code(500).send({ code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) });
  });

  app.get<{ Params: { owner: string; repo: string; number: string }; Querystring: { fresh?: string } }>(
    '/api/pulls/:owner/:repo/:number',
    async (req) => {
      const params = parsePullParams(req.params);
      const key = metaKey(params);
      if (req.query.fresh !== '1') {
        const cached = metaCache.get(key);
        if (cached) return cached;
      }
      const meta = await fetchMeta(params.owner, params.repo, params.number);
      metaCache.set(key, meta);
      return meta;
    },
  );

  app.get<{ Params: { owner: string; repo: string; number: string }; Querystring: { fresh?: string } }>(
    '/api/pulls/:owner/:repo/:number/diff',
    async (req, reply) => {
      const params = parsePullParams(req.params);
      const metaCached = metaCache.get(metaKey(params));
      const meta = metaCached ?? (await fetchMeta(params.owner, params.repo, params.number));
      if (!metaCached) metaCache.set(metaKey(params), meta);

      const dkey = diffKey({ ...params, headSha: meta.headSha });
      if (req.query.fresh !== '1') {
        const cached = diffCache.get(dkey);
        if (cached !== undefined) {
          reply.type('text/plain; charset=utf-8');
          return cached;
        }
      }
      const diff = await ghExec(['pr', 'diff', String(params.number), '--repo', `${params.owner}/${params.repo}`]);
      diffCache.set(dkey, diff);
      reply.type('text/plain; charset=utf-8');
      return diff;
    },
  );

  // Create a review on the PR. event=PENDING creates a draft review (returned id can be
  // passed to /threads to attach more comments, and later to /reviews/:id/submit).
  // event=APPROVE/REQUEST_CHANGES/COMMENT immediately publishes the review.
  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: CreateReviewBody;
  }>('/api/pulls/:owner/:repo/:number/reviews', async (req) => {
    const params = parsePullParams(req.params);
    // GitHub allows only one pending review per (user, PR), so we need an accurate
    // view of `viewerPendingReviewId` before deciding to create vs. submit. The cached
    // meta can be stale (the user may have a leftover pending review from a previous
    // session or from github.com), which used to cause the second "Comment" click to
    // hard-fail. Refresh once up front — cheap and avoids the round-trip-to-failure.
    const meta = await fetchMeta(params.owner, params.repo, params.number);
    metaCache.set(metaKey(params), meta);

    // Attach any inline threads in `req.body.threads` to the given review.
    const attachThreads = async (reviewId: string, prId: string) => {
      for (const t of req.body.threads ?? []) {
        const tv = toThreadVariable(t);
        await ghExec(['api', 'graphql', '--input', '-'], {
          input: JSON.stringify({
            query: ADD_PULL_REQUEST_REVIEW_THREAD_MUTATION,
            variables: { ...tv, pullRequestId: prId, pullRequestReviewId: reviewId },
          }),
        });
      }
    };

    // Submit (publish) an existing pending review with the requested event + body.
    const submitPending = async (reviewId: string) => {
      const variables: Record<string, unknown> = {
        pullRequestReviewId: reviewId,
        event: req.body.event,
      };
      if (req.body.body) variables.body = req.body.body;
      const out = await ghExec(['api', 'graphql', '--input', '-'], {
        input: JSON.stringify({ query: SUBMIT_PULL_REQUEST_REVIEW_MUTATION, variables }),
      });
      const parsed = JSON.parse(out) as GraphQLResp<{ submitPullRequestReview?: { pullRequestReview?: { id: string; state: string } } }>;
      const review = parsed.data?.submitPullRequestReview?.pullRequestReview;
      if (!review) {
        throw graphqlReturnedNullError('Review submit', out, parsed);
      }
      return review;
    };

    // Case 1: pending review exists. Attach any new threads to it, then either keep
    // it pending (event=PENDING) or publish it (event=COMMENT/APPROVE/REQUEST_CHANGES).
    // This is what GitHub itself does — clicking Comment with a draft review publishes
    // the draft rather than creating a parallel one.
    if (meta.viewerPendingReviewId) {
      const reviewId = meta.viewerPendingReviewId;
      await attachThreads(reviewId, meta.id);
      if (req.body.event === 'PENDING') {
        return { id: reviewId, state: 'PENDING' };
      }
      return await submitPending(reviewId);
    }

    // Case 2: no pending review — create a fresh one.
    const variables: Record<string, unknown> = { pullRequestId: meta.id };
    // PullRequestReviewEvent enum only accepts APPROVE/REQUEST_CHANGES/COMMENT/DISMISS.
    // Omit `event` entirely to create a PENDING (draft) review.
    if (req.body.event !== 'PENDING') variables.event = req.body.event;
    if (req.body.body) variables.body = req.body.body;
    if (req.body.threads?.length) {
      variables.threads = req.body.threads.map(toThreadVariable);
    }

    try {
      const out = await ghExec(['api', 'graphql', '--input', '-'], {
        input: JSON.stringify({ query: ADD_PULL_REQUEST_REVIEW_MUTATION, variables }),
      });
      const parsed = JSON.parse(out) as GraphQLResp<{ addPullRequestReview?: { pullRequestReview?: { id: string; state: string } } }>;
      const review = parsed.data?.addPullRequestReview?.pullRequestReview;
      if (!review) {
        throw graphqlReturnedNullError('Review creation', out, parsed, {
          variables: {
            pullRequestId: meta.id,
            event: variables.event,
            threadCount: (variables.threads as unknown[] | undefined)?.length ?? 0,
            threadPaths: ((variables.threads as Array<{ path?: string }> | undefined) ?? []).map((t) => t.path).join(', '),
          },
        });
      }
      return review;
    } catch (err) {
      // Last-ditch race recovery: a pending review appeared between our meta fetch and
      // the create mutation. Attach threads to it and either keep pending or publish.
      const isOnePendingErr = err instanceof GhCliError && /one pending review/i.test(err.stderr);
      if (isOnePendingErr) {
        const fresh = await fetchMeta(params.owner, params.repo, params.number);
        metaCache.set(metaKey(params), fresh);
        if (fresh.viewerPendingReviewId) {
          await attachThreads(fresh.viewerPendingReviewId, fresh.id);
          if (req.body.event === 'PENDING') {
            return { id: fresh.viewerPendingReviewId, state: 'PENDING' };
          }
          return await submitPending(fresh.viewerPendingReviewId);
        }
      }
      throw err;
    }
  });

  // Create a single review-thread comment. If pullRequestReviewId is set, the comment is
  // attached to that pending review; otherwise it posts as a standalone PR review comment.
  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: CreateThreadBody;
  }>('/api/pulls/:owner/:repo/:number/threads', async (req) => {
    const params = parsePullParams(req.params);
    const meta = metaCache.get(metaKey(params)) ?? (await fetchMeta(params.owner, params.repo, params.number));
    metaCache.set(metaKey(params), meta);

    const variables: Record<string, unknown> = {
      pullRequestId: meta.id,
      path: req.body.path,
      body: req.body.body,
      line: req.body.line,
      side: req.body.side,
    };
    if (req.body.startLine != null && req.body.startLine !== req.body.line) {
      variables.startLine = req.body.startLine;
      variables.startSide = req.body.startSide ?? req.body.side;
    }
    if (req.body.pullRequestReviewId) {
      variables.pullRequestReviewId = req.body.pullRequestReviewId;
    }

    const out = await ghExec(['api', 'graphql', '--input', '-'], {
      input: JSON.stringify({ query: ADD_PULL_REQUEST_REVIEW_THREAD_MUTATION, variables }),
    });
    const parsed = JSON.parse(out) as { data?: { addPullRequestReviewThread?: { thread?: { id: string } } } };
    return parsed.data?.addPullRequestReviewThread?.thread ?? {};
  });

  // Submit a pending review.
  app.post<{
    Params: { owner: string; repo: string; number: string; reviewId: string };
    Body: SubmitReviewBody;
  }>('/api/pulls/:owner/:repo/:number/reviews/:reviewId/submit', async (req) => {
    parsePullParams(req.params);
    const variables: Record<string, unknown> = {
      pullRequestReviewId: req.params.reviewId,
      event: req.body.event,
    };
    if (req.body.body) variables.body = req.body.body;
    const out = await ghExec(['api', 'graphql', '--input', '-'], {
      input: JSON.stringify({ query: SUBMIT_PULL_REQUEST_REVIEW_MUTATION, variables }),
    });
    const parsed = JSON.parse(out) as { data?: { submitPullRequestReview?: { pullRequestReview?: { id: string; state: string } } } };
    return parsed.data?.submitPullRequestReview?.pullRequestReview ?? {};
  });

  // Fetch a file's full text at a given ref so the diff viewer can expand unchanged
  // context above/below a hunk. Cached briefly via the existing diff cache key.
  app.get<{
    Params: { owner: string; repo: string; number: string };
    Querystring: { path: string; ref: string };
  }>('/api/pulls/:owner/:repo/:number/files/content', async (req, reply) => {
    parsePullParams(req.params);
    const { path, ref } = req.query;
    if (!path || !ref) {
      reply.code(400).send({ code: 'BAD_PARAMS', message: 'path and ref query params are required' });
      return;
    }
    const out = await ghExec([
      'api',
      `repos/${req.params.owner}/${req.params.repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`,
      '--jq', '.content',
    ]);
    const b64 = out.trim().replace(/^"|"$/g, '').replace(/\\n/g, '');
    const text = Buffer.from(b64, 'base64').toString('utf8');
    reply.type('text/plain; charset=utf-8');
    return text;
  });

  app.post<{
    Params: { owner: string; repo: string; number: string; threadId: string };
    Body: { body: string };
  }>('/api/pulls/:owner/:repo/:number/threads/:threadId/reply', async (req) => {
    parsePullParams(req.params);
    const out = await ghExec([
      'api', 'graphql',
      '-f', `query=${ADD_PULL_REQUEST_REVIEW_THREAD_REPLY_MUTATION}`,
      '-F', `pullRequestReviewThreadId=${req.params.threadId}`,
      '-f', `body=${req.body.body}`,
    ]);
    return JSON.parse(out);
  });

  // Attach (or replace) labels on a PR.
  //   - mode: 'add' (default) → POST /labels, idempotent for already-present labels.
  //   - mode: 'replace'       → PUT  /labels, SETS the label list to exactly `labels`
  //                             (drops every other label currently on the PR).
  // Both forms take label *names* — no need to resolve IDs.
  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: { labels?: string[]; mode?: 'add' | 'replace' };
  }>('/api/pulls/:owner/:repo/:number/labels', async (req, reply) => {
    const params = parsePullParams(req.params);
    const labels = (req.body?.labels ?? []).filter((l) => typeof l === 'string' && l.trim().length > 0);
    const mode = req.body?.mode ?? 'add';
    if (labels.length === 0) {
      reply.code(400).send({ code: 'BAD_PARAMS', message: 'labels must be a non-empty string[]' });
      return;
    }
    const out = await ghExec([
      'api',
      `repos/${params.owner}/${params.repo}/issues/${params.number}/labels`,
      '--method', mode === 'replace' ? 'PUT' : 'POST',
      '--input', '-',
    ], { input: JSON.stringify({ labels }) });
    // GitHub's REST POST/PUT .../labels returns the full updated label list
    // with each label's real `color` (the hex configured in the repo). Use
    // that to update our cache instead of hardcoding a grey `888888` —
    // otherwise the chip on the row renders grey until the next real meta
    // refetch overwrites it with the actual color from GraphQL.
    let respLabels: Array<{ name: string; color: string }> = [];
    try {
      const parsed = JSON.parse(out) as Array<{ name?: string; color?: string }>;
      if (Array.isArray(parsed)) {
        respLabels = parsed
          .filter((l) => typeof l?.name === 'string')
          .map((l) => ({ name: l.name as string, color: typeof l.color === 'string' ? l.color : '888888' }));
      }
    } catch { /* fall back to whatever we have */ }

    const cached = metaCache.get(metaKey(params));
    if (cached) {
      if (mode === 'replace') {
        // After PUT, the PR's label list IS exactly the response.
        const next = respLabels.length > 0
          ? respLabels
          : labels.map((l) => ({ name: l, color: '888888' }));
        metaCache.set(metaKey(params), { ...cached, labels: next });
      } else {
        // POST appended — union with what was already there, preferring real
        // colors from the response for any labels we added.
        const realColorByName = new Map(respLabels.map((l) => [l.name, l.color]));
        const merged = [...(cached.labels ?? [])];
        for (const newName of labels) {
          const exists = merged.find((m) => m.name === newName);
          const realColor = realColorByName.get(newName);
          if (exists) {
            if (realColor) exists.color = realColor;
          } else {
            merged.push({ name: newName, color: realColor ?? '888888' });
          }
        }
        metaCache.set(metaKey(params), { ...cached, labels: merged });
      }
    }
    return { ok: true, labels: respLabels, mode };
  });

  // Remove a single label from a PR by name. Idempotent — removing a label
  // that's already absent returns 200 (we eat GitHub's 404). Backed by
  // DELETE /repos/{o}/{r}/issues/{n}/labels/{label_name}.
  app.delete<{ Params: { owner: string; repo: string; number: string; label: string } }>(
    '/api/pulls/:owner/:repo/:number/labels/:label',
    async (req) => {
      const params = parsePullParams({ owner: req.params.owner, repo: req.params.repo, number: req.params.number });
      const labelName = decodeURIComponent(req.params.label);
      try {
        await ghExec([
          'api',
          `repos/${params.owner}/${params.repo}/issues/${params.number}/labels/${encodeURIComponent(labelName)}`,
          '--method', 'DELETE',
        ]);
      } catch (e) {
        // Label not present — treat as success so the caller doesn't have to check.
        if (e instanceof GhCliError && /HTTP 404/i.test(e.stderr)) {
          // fall through to success
        } else {
          throw e;
        }
      }
      // Drop the label from the cached meta so the next render reflects it.
      const cached = metaCache.get(metaKey(params));
      if (cached) {
        metaCache.set(metaKey(params), { ...cached, labels: (cached.labels ?? []).filter((l) => l.name !== labelName) });
      }
      return { ok: true, removed: labelName };
    },
  );

  // Bounce the user's draft comment off the local `claude` CLI for feedback.
  // Never publishes anything — purely a "what would Claude say to this?" loop.
  // Context = PR title + author + full diff (truncated if huge) + optional line range.
  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: {
      draft?: string;
      lineRange?: {
        path: string;
        startLine?: number;
        endLine: number;
        side: 'LEFT' | 'RIGHT';
      };
      /** Prior turns when continuing a chat. Most-recent-first or oldest-first
       * doesn't matter — we render them in order. Each turn's `body` goes into
       * the prompt verbatim labeled by role. */
      conversation?: Array<{ role: 'user' | 'claude'; body: string }>;
      /** Optional local checkout path. When valid (exists + has .git), `claude -p`
       * runs with that as its cwd so Claude can grep / read the actual repo
       * being reviewed. Without it, Claude runs from the server's cwd (the
       * connor-review repo) and can't see the target codebase. */
      repoPath?: string;
    };
  }>('/api/pulls/:owner/:repo/:number/claude/ask', async (req, reply) => {
    const params = parsePullParams(req.params);
    const draft = (req.body?.draft ?? '').trim();
    if (!draft) {
      reply.code(400).send({ code: 'BAD_PARAMS', message: 'draft must be a non-empty string' });
      return;
    }

    // Get meta (title + author) from cache if we can.
    const meta = metaCache.get(metaKey(params)) ?? (await fetchMeta(params.owner, params.repo, params.number));
    metaCache.set(metaKey(params), meta);

    // Get the diff. Reuse the diff cache (keyed by head SHA).
    const dkey = diffKey({ ...params, headSha: meta.headSha });
    let diff = diffCache.get(dkey);
    if (diff === undefined) {
      diff = await ghExec(['pr', 'diff', String(params.number), '--repo', `${params.owner}/${params.repo}`]);
      diffCache.set(dkey, diff);
    }

    // Truncate enormous diffs so we don't blow the model context. ~150k chars ≈ 40k tokens.
    const DIFF_CHAR_BUDGET = 150_000;
    const truncated = diff.length > DIFF_CHAR_BUDGET;
    const diffForPrompt = truncated
      ? diff.slice(0, DIFF_CHAR_BUDGET) + `\n\n[... diff truncated, original was ${diff.length} characters ...]`
      : diff;

    const lineRangeBlock = req.body.lineRange
      ? `\nThe user is commenting on ${req.body.lineRange.path} ${req.body.lineRange.startLine != null && req.body.lineRange.startLine !== req.body.lineRange.endLine ? `lines ${req.body.lineRange.startLine}–${req.body.lineRange.endLine}` : `line ${req.body.lineRange.endLine}`} (${req.body.lineRange.side === 'LEFT' ? 'old/deleted side' : 'new/added side'}).\n`
      : '';

    // Multi-turn chat: prior turns go into the prompt so Claude has context.
    // The user's latest draft is appended as the "latest message" block.
    const priorTurns = (req.body.conversation ?? []).filter((t) => t && typeof t.body === 'string' && t.body.length > 0);
    const conversationBlock = priorTurns.length > 0
      ? '\nConversation so far:\n' + priorTurns.map((t) => {
          const label = t.role === 'claude' ? 'Claude' : 'User';
          return `[${label}]:\n${t.body}\n`;
        }).join('\n')
      : '';

    const prompt = [
      `You're helping the user review GitHub PR "${meta.title}" by @${meta.authorLogin ?? 'unknown'} on ${params.owner}/${params.repo}.`,
      '',
      'Full unified diff:',
      '```diff',
      diffForPrompt,
      '```',
      lineRangeBlock,
      conversationBlock,
      priorTurns.length > 0 ? "User's latest message:" : "User's draft comment:",
      '> ' + draft.replace(/\n/g, '\n> '),
      '',
      'Respond as a thoughtful, concise code reviewer would — engage with the user\'s point, flag anything they may have missed, suggest follow-ups when useful. Do not pretend to be the PR author. When a prior conversation is present, build on it (do not repeat earlier explanations verbatim). Keep the response focused and well under 400 words unless the question genuinely demands more.',
    ].join('\n');

    // Resolve cwd for claude: only honor the path if it's a real directory with
    // a .git subdir. Anything else falls back to default (claude runs in the
    // server's cwd) so a stale config doesn't error out the whole request.
    let claudeCwd: string | undefined;
    if (req.body.repoPath) {
      const abs = resolvePath(req.body.repoPath);
      try {
        if (existsSync(abs) && statSync(abs).isDirectory() && existsSync(resolvePath(abs, '.git'))) {
          claudeCwd = abs;
        }
      } catch { /* ignore — fall back to default cwd */ }
    }

    try {
      const response = await claudeExec(prompt, { cwd: claudeCwd });
      return { response: response.trim(), truncatedDiff: truncated };
    } catch (e) {
      if (e instanceof ClaudeCliError) {
        const status = e.code === 'CLAUDE_NOT_INSTALLED' ? 502 : e.code === 'TIMEOUT' ? 504 : 500;
        reply.code(status).send({ code: e.code, message: e.message, stderr: e.stderr });
        return;
      }
      throw e;
    }
  });

  // Close the PR on GitHub (without merging). The client gates this behind a
  // confirm prompt; the underlying mutation is idempotent — closing an
  // already-closed PR is a no-op upstream. The cached meta is dropped so the
  // next fetch reflects state='CLOSED'.
  app.post<{ Params: { owner: string; repo: string; number: string } }>(
    '/api/pulls/:owner/:repo/:number/close',
    async (req) => {
      const params = parsePullParams(req.params);
      const meta = metaCache.get(metaKey(params)) ?? (await fetchMeta(params.owner, params.repo, params.number));
      await ghExec(['api', 'graphql', '--input', '-'], {
        input: JSON.stringify({
          query: CLOSE_PULL_REQUEST_MUTATION,
          variables: { pullRequestId: meta.id },
        }),
      });
      metaCache.set(metaKey(params), { ...meta, state: 'CLOSED', merged: false });
      return { ok: true, state: 'CLOSED' };
    },
  );

  // Flip a draft PR to ready-for-review. Invalidates the cached meta so the
  // next /api/pulls/... fetch reflects the new state.
  app.post<{ Params: { owner: string; repo: string; number: string } }>(
    '/api/pulls/:owner/:repo/:number/ready-for-review',
    async (req) => {
      const params = parsePullParams(req.params);
      const meta = metaCache.get(metaKey(params)) ?? (await fetchMeta(params.owner, params.repo, params.number));
      const out = await ghExec(['api', 'graphql', '--input', '-'], {
        input: JSON.stringify({
          query: MARK_READY_FOR_REVIEW_MUTATION,
          variables: { pullRequestId: meta.id },
        }),
      });
      // Drop the cached meta so a follow-up fetch sees the new isDraft=false.
      metaCache.set(metaKey(params), { ...meta, isDraft: false });
      const parsed = JSON.parse(out) as { data?: { markPullRequestReadyForReview?: { pullRequest?: { id: string; isDraft: boolean } } } };
      return parsed.data?.markPullRequestReadyForReview?.pullRequest ?? { id: meta.id, isDraft: false };
    },
  );

  // Enable "merge when ready" (GitHub's auto-merge). Default method is SQUASH —
  // matches the Gusto/zenpayroll convention; future config could override.
  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: { mergeMethod?: 'MERGE' | 'SQUASH' | 'REBASE' };
  }>('/api/pulls/:owner/:repo/:number/auto-merge', async (req) => {
    const params = parsePullParams(req.params);
    const mergeMethod = req.body?.mergeMethod ?? 'SQUASH';
    const meta = metaCache.get(metaKey(params)) ?? (await fetchMeta(params.owner, params.repo, params.number));
    const out = await ghExec(['api', 'graphql', '--input', '-'], {
      input: JSON.stringify({
        query: ENABLE_AUTO_MERGE_MUTATION,
        variables: { pullRequestId: meta.id, mergeMethod },
      }),
    });
    const parsed = JSON.parse(out) as {
      data?: { enablePullRequestAutoMerge?: { pullRequest?: { id: string; autoMergeRequest?: { mergeMethod?: string; enabledAt?: string; enabledBy?: { login?: string } } } } };
      errors?: Array<{ message?: string }>;
    };
    const pr = parsed.data?.enablePullRequestAutoMerge?.pullRequest;
    if (!pr) {
      const detail = (parsed.errors ?? []).map((e) => e.message).filter(Boolean).join('; ');
      throw new Error(detail ? `Auto-merge failed: ${detail}` : 'Auto-merge mutation returned no pullRequest');
    }
    // Patch the cache so the next list refresh / drawer reload sees it on without
    // another GraphQL round trip.
    const next = pr.autoMergeRequest
      ? {
          mergeMethod: (pr.autoMergeRequest.mergeMethod ?? mergeMethod) as 'MERGE' | 'SQUASH' | 'REBASE',
          enabledBy: pr.autoMergeRequest.enabledBy?.login ?? null,
          enabledAt: pr.autoMergeRequest.enabledAt ?? null,
        }
      : null;
    metaCache.set(metaKey(params), { ...meta, autoMergeRequest: next });
    return { autoMergeRequest: next };
  });

  // Disable "merge when ready". Idempotent — disabling when not enabled is a
  // no-op upstream.
  app.delete<{ Params: { owner: string; repo: string; number: string } }>(
    '/api/pulls/:owner/:repo/:number/auto-merge',
    async (req) => {
      const params = parsePullParams(req.params);
      const meta = metaCache.get(metaKey(params)) ?? (await fetchMeta(params.owner, params.repo, params.number));
      await ghExec(['api', 'graphql', '--input', '-'], {
        input: JSON.stringify({
          query: DISABLE_AUTO_MERGE_MUTATION,
          variables: { pullRequestId: meta.id },
        }),
      });
      metaCache.set(metaKey(params), { ...meta, autoMergeRequest: null });
      return { autoMergeRequest: null };
    },
  );

  // Post the Trunk merge bot's slash command as a PR comment. For repos
  // configured in `trunkMergeRepos`, the "Merge when ready" UI button routes
  // here instead of GitHub's auto-merge mutation — Trunk owns the queue, so
  // `/trunk merge` / `/trunk cancel` is the canonical interface.
  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: { action: 'enable' | 'cancel' };
  }>('/api/pulls/:owner/:repo/:number/trunk-merge', async (req, reply) => {
    const params = parsePullParams(req.params);
    const action = req.body?.action;
    if (action !== 'enable' && action !== 'cancel') {
      reply.code(400).send({ code: 'BAD_PARAMS', message: 'action must be "enable" or "cancel"' });
      return;
    }
    const body = action === 'enable' ? '/trunk merge' : '/trunk cancel';
    // Use gh pr comment so we don't have to thread the issue-comment GraphQL
    // mutation. `--repo o/r` keeps the call repo-scoped regardless of cwd.
    await ghExec([
      'pr', 'comment', String(params.number),
      '--repo', `${params.owner}/${params.repo}`,
      '--body', body,
    ]);
    return { ok: true, action, body };
  });

  // Equivalent of GitHub's "Update branch" button — merges the PR's base
  // branch into its head. Used by tag-driven workflows that want to catch
  // a PR up with main without rewriting history (rebase is the Fix CI
  // sentinel's job; this is the lighter complement).
  app.post<{ Params: { owner: string; repo: string; number: string } }>(
    '/api/pulls/:owner/:repo/:number/update-branch',
    async (req, reply) => {
      const params = parsePullParams(req.params);
      try {
        await ghExec([
          'api',
          '-X', 'PUT',
          `repos/${params.owner}/${params.repo}/pulls/${params.number}/update-branch`,
        ]);
        return { ok: true };
      } catch (e) {
        if (e instanceof GhCliError) {
          reply.code(502).send({ code: 'UPDATE_BRANCH_FAILED', message: e.message, stderr: e.stderr });
          return;
        }
        throw e;
      }
    },
  );

  // Ask Claude to resolve the PR's merge conflicts locally and push the
  // resolution back to GitHub. Safety-first: every git operation runs in a
  // throwaway worktree, Claude is constrained to Read/Edit only, and three
  // independent checks gate the commit + push step. See route body for the
  // full safety contract.
  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: { repoPath?: string };
  }>('/api/pulls/:owner/:repo/:number/resolve-conflicts', async (req, reply) => {
    const params = parsePullParams(req.params);
    const repoPath = (req.body?.repoPath ?? '').trim();
    if (!repoPath) {
      reply.code(400).send({ code: 'BAD_REPO_PATH', message: 'repoPath is required (configure localRepos for this repo)' });
      return;
    }
    let absRepoPath: string;
    try {
      const abs = resolvePath(repoPath);
      if (!existsSync(abs) || !statSync(abs).isDirectory() || !existsSync(resolvePath(abs, '.git'))) {
        reply.code(400).send({ code: 'BAD_REPO_PATH', message: `Not a git checkout: ${abs}` });
        return;
      }
      absRepoPath = abs;
    } catch (e) {
      reply.code(400).send({ code: 'BAD_REPO_PATH', message: (e as Error).message });
      return;
    }

    const meta = metaCache.get(metaKey(params)) ?? (await fetchMeta(params.owner, params.repo, params.number));
    const baseRef = meta.baseRefName;
    const headRef = meta.headRefName;
    const remoteHead = `origin/${headRef}`;
    const remoteBase = `origin/${baseRef}`;

    // Unique worktree path. We never reuse a path between attempts so a botched
    // prior cleanup can't poison the next run.
    const stamp = Date.now();
    const worktreePath = resolvePath(tmpdir(),
      `connor-review-resolve-${params.owner}-${params.repo}-${params.number}-${stamp}`);
    // Unique ephemeral branch name for the worktree. We never reuse the PR's
    // own branch name because that branch may already be checked out in
    // another worktree (e.g. the user's main repo or a `~/.work/worktrees/...`
    // directory), and `git worktree add -B <branch>` refuses in that case.
    // Pushing back to the remote uses an explicit `HEAD:<headRef>` refspec
    // so the upstream branch name is unaffected.
    const tempBranch = `connor-review-resolve-${params.number}-${stamp}`;

    /** Best-effort cleanup; tolerated to fail (the worktree may already be in
     * a state where remove --force can't run, e.g. external process holding a
     * file). Logs the failure but doesn't surface to the user since the main
     * route response carries the actionable info. */
    const cleanup = async () => {
      try { await gitExec(['merge', '--abort'], { cwd: worktreePath }); } catch { /* not in a merge */ }
      try { await gitExec(['worktree', 'remove', '--force', worktreePath], { cwd: absRepoPath }); } catch (e) {
        // Force-remove the dir if git won't (e.g. corrupted worktree metadata).
        try {
          if (existsSync(worktreePath)) {
            const { rmSync } = await import('node:fs');
            rmSync(worktreePath, { recursive: true, force: true });
          }
        } catch { /* give up */ }
        console.warn(`[resolve-conflicts] worktree cleanup failed for ${worktreePath}:`, (e as Error).message);
      }
      // Delete the ephemeral branch even if the worktree-remove failed —
      // otherwise stale branches accumulate in the user's repo.
      try { await gitExec(['branch', '-D', tempBranch], { cwd: absRepoPath }); } catch { /* not created or already gone */ }
    };

    try {
      // 1) Make sure we have the latest base + head refs locally.
      await gitExec(['fetch', 'origin', baseRef, headRef], { cwd: absRepoPath });

      // 2+3) Create a worktree pinned at origin/<headRef> on an ephemeral
      // local branch (NOT the PR's own branch name — that may be checked out
      // elsewhere). We push back via an explicit refspec later.
      await gitExec(['worktree', 'add', '-B', tempBranch, worktreePath, remoteHead], { cwd: absRepoPath });

      // Snapshot the pre-merge HEAD SHA so safety check #3 can verify the
      // first parent of the merge commit matches it.
      const preMergeHead = (await gitExec(['rev-parse', 'HEAD'], { cwd: worktreePath })).trim();

      // 4) Attempt the merge. `--no-commit` keeps the merge unfinalised so the
      // commit step we run later (explicitly with --no-verify) is the one that
      // creates the commit, regardless of whether there were conflicts. This
      // avoids the auto-commit code path running pre-commit hooks on a clean
      // merge. gitExec rejects on non-zero exit, but a merge with conflicts
      // also exits non-zero — we distinguish hard failures from conflict
      // failures by inspecting the resulting state.
      let mergeFailed = false;
      try {
        await gitExec(['merge', '--no-commit', '--no-ff', remoteBase], { cwd: worktreePath });
      } catch (e) {
        if (!(e instanceof GitCliError)) throw e;
        mergeFailed = true;
      }

      // 5) Snapshot the conflict file set. Empty means either a clean merge
      // (no conflicts) or a non-conflict merge failure (e.g. base ref missing).
      const conflictListRaw = (await gitExec(['diff', '--name-only', '--diff-filter=U'], { cwd: worktreePath })).trim();
      const conflictFiles = conflictListRaw.split('\n').map((s) => s.trim()).filter(Boolean);

      if (conflictFiles.length === 0) {
        if (!mergeFailed) {
          // Clean merge — commit + push. `--no-verify` to bypass the user's
          // pre-commit / pre-push hooks (often `bundle exec rubocop`/`sorbet`
          // in monorepos), which aren't reachable from a fresh worktree.
          await gitExec(['commit', '--no-verify', '-m', `Merge ${baseRef} into ${headRef}`], { cwd: worktreePath });
          await gitExec(['push', '--no-verify', 'origin', `HEAD:${headRef}`], { cwd: worktreePath });
          const sha = (await gitExec(['rev-parse', 'HEAD'], { cwd: worktreePath })).trim();
          reply.send({ ok: true, commitSha: sha, trivial: true });
          return;
        }
        reply.code(409).send({ code: 'MERGE_FAILED', message: 'git merge failed without reporting conflict files; aborting' });
        return;
      }

      // 6.5) Pre-Claude snapshot: hash the current contents of every file the
      // merge touched (conflict files + auto-merged files + custom-driver
      // results). After Claude runs we compare hashes for the NON-conflict
      // subset — any drift there is over-commit by Claude. Git's own merge
      // resolutions (renames, Gemfile.lock driver, etc.) are captured in this
      // snapshot, so they don't false-positive.
      const conflictSet = new Set(conflictFiles);
      const statusOutPre = await gitExec(['status', '--porcelain', '-z'], { cwd: worktreePath });
      const mergeStatusPaths = new Set<string>(
        statusOutPre.split('\0').filter(Boolean).map((r) => r.slice(3)),
      );
      const hashFile = (rel: string): string | null => {
        const abs = resolvePath(worktreePath, rel);
        if (!existsSync(abs)) return null;
        try {
          // Buffer mode: handles binary files (lockfiles, images) without
          // throwing on invalid UTF-8.
          return createHash('sha256').update(readFileSync(abs)).digest('hex');
        } catch { return null; }
      };
      const preHashes = new Map<string, string | null>();
      for (const p of mergeStatusPaths) preHashes.set(p, hashFile(p));

      // 7) Hand the conflict files to Claude.
      const prompt = [
        `You are resolving git merge conflicts in a local checkout of ${params.owner}/${params.repo}`,
        `for PR #${params.number} ("${meta.title}") by @${meta.authorLogin ?? 'unknown'}.`,
        '',
        `The repo lives at ${worktreePath} and is your CWD.`,
        '',
        `IMPORTANT: We are MERGING ${remoteBase} INTO the PR branch (${headRef}).`,
        `This is a forward merge — origin/${baseRef} is the incoming side; ${headRef} is HEAD.`,
        'We are NOT rebasing. The branch history is preserved; one new merge commit will land',
        `on ${headRef} carrying both sides of the work forward.`,
        '',
        'The following files have conflict markers:',
        '',
        ...conflictFiles.map((f) => `  - ${f}`),
        '',
        'Your task:',
        '1. Open each file and resolve every conflict marker (<<<<<<<, =======, >>>>>>>).',
        `2. Combine both sides so each intent is preserved. HEAD is the PR branch — when the`,
        '   two sides genuinely contradict, prefer keeping the PR\'s changes intact while',
        `   layering in compatible updates from origin/${baseRef}.`,
        '3. Do NOT modify any file not in the list above. Do NOT create or delete files.',
        '   Do NOT run any commands — no git, no shell. Use only Read and Edit.',
        '4. When you are done, briefly summarise which conflict you resolved in each file.',
        '   Do not propose follow-up changes.',
        '',
        'A subsequent verification step will reject the resolution if any conflict markers remain,',
        'or if the resulting merge commit ends up changing files outside the conflict set in ways',
        'that go beyond what the underlying three-way merge already does.',
      ].join('\n');

      try {
        await claudeExec(prompt, {
          cwd: worktreePath,
          allowedTools: ['Read', 'Edit'],
          permissionMode: 'acceptEdits',
          timeoutMs: 15 * 60_000,
        });
      } catch (e) {
        if (e instanceof ClaudeCliError) {
          const status = e.code === 'CLAUDE_NOT_INSTALLED' ? 502 : e.code === 'TIMEOUT' ? 504 : 500;
          reply.code(status).send({ code: e.code, message: e.message, stderr: e.stderr });
          return;
        }
        throw e;
      }

      // 8) Safety check #1 — no residual markers in any conflict file.
      const markerOffenders: string[] = [];
      for (const rel of conflictFiles) {
        const abs = resolvePath(worktreePath, rel);
        if (!existsSync(abs)) {
          // Claude deleted the file. That violates the contract.
          markerOffenders.push(`${rel} (deleted by Claude)`);
          continue;
        }
        const content = readFileSync(abs, 'utf8');
        if (content.includes('<<<<<<<') || content.includes('=======\n') || content.includes('>>>>>>>')) {
          markerOffenders.push(rel);
        }
      }
      if (markerOffenders.length > 0) {
        reply.code(409).send({
          code: 'LEFTOVER_MARKERS',
          message: `Conflict markers remain in ${markerOffenders.length} file(s) after Claude's edits.`,
          files: markerOffenders,
        });
        return;
      }

      // 9) Safety check #2 — content hash diff against the pre-Claude
      // snapshot. For every file in the merge's status set that's NOT in the
      // conflict set, the hash must be unchanged after Claude returns. Any
      // drift means Claude modified a file outside the conflict set.
      //
      // This replaces the earlier `git diff-tree --cc` check, which
      // false-positived on files git itself produced a non-trivial resolution
      // for (rename + modify, Gemfile.lock / yarn.lock with custom merge
      // drivers, .gitattributes merge=union, etc.). Those files DO end up in
      // `--cc` even when Claude never touched them, because the combined diff
      // reflects "differs from a clean three-way merge" — git's own
      // resolutions qualify. Hash comparison is precise: git's resolutions
      // are baked into the pre-snapshot, so they read as unchanged.
      const overcommit: string[] = [];
      for (const [path, preHash] of preHashes) {
        if (conflictSet.has(path)) continue; // expected to differ — that's the resolution
        const postHash = hashFile(path);
        if (postHash !== preHash) overcommit.push(path);
      }
      // Belt-and-suspenders: Claude's allowed-tool list is Read/Edit only, so
      // it shouldn't be able to create new files. But if a path appears in
      // post-merge status that wasn't in the pre-Claude snapshot AND isn't a
      // conflict file, flag it.
      const statusOutPost = await gitExec(['status', '--porcelain', '-z'], { cwd: worktreePath });
      for (const record of statusOutPost.split('\0').filter(Boolean)) {
        const path = record.slice(3);
        if (conflictSet.has(path)) continue;
        if (mergeStatusPaths.has(path)) continue; // already covered by the hash diff above
        overcommit.push(path);
      }
      if (overcommit.length > 0) {
        reply.code(409).send({
          code: 'OVERCOMMIT_DETECTED',
          message: `Claude modified ${overcommit.length} file(s) outside the conflict set; aborting.`,
          files: overcommit,
        });
        return;
      }

      // Stage ONLY the conflict files. Auto-merged files were already staged
      // by `git merge`; any other working-tree changes Claude may have made
      // are left in the worktree and discarded on cleanup. Combined with the
      // hash check above, this makes it doubly hard for an over-touched file
      // to enter the commit.
      await gitExec(['add', '--', ...conflictFiles], { cwd: worktreePath });

      // Commit the merge resolution. `--no-verify` skips pre-commit /
      // commit-msg hooks: in monorepos those hooks typically shell out to
      // `bundle exec rubocop / sorbet / tapioca`, which require the user's
      // gem install + workspace-local caches. A fresh worktree doesn't have
      // those, so hooks fail spuriously even though the commit content is
      // mechanically correct. Linting concerns belong on the user's normal
      // dev workflow, not on an auto-resolve merge commit.
      await gitExec(['commit', '--no-verify', '-m', `Resolve merge conflicts with ${baseRef}`], { cwd: worktreePath });

      // Safety check #3 — commit shape:
      //   a. exactly two parents (it's a real merge commit)
      //   b. first parent == pre-merge HEAD of the PR branch
      //
      // We deliberately do NOT verify the file set of the commit here — the
      // combined-diff (`--cc`) approach false-positived on git's own
      // non-trivial resolutions (custom merge drivers, renames). The content-
      // hash check (#2 above) already catches Claude over-commit at the file
      // level; this check exists to catch rebase-style mistakes where the
      // commit doesn't have the expected merge shape (one new commit, two
      // parents, the first being the PR's pre-merge HEAD).
      const parentsLine = (await gitExec(['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd: worktreePath })).trim();
      const parts = parentsLine.split(/\s+/).filter(Boolean);
      const commitSha = parts[0] ?? '';
      const parents = parts.slice(1);
      if (parents.length !== 2) {
        reply.code(409).send({ code: 'OVERCOMMIT_DETECTED', message: `Expected a merge commit (2 parents), got ${parents.length}` });
        return;
      }
      if (parents[0] !== preMergeHead) {
        reply.code(409).send({
          code: 'OVERCOMMIT_DETECTED',
          message: `Merge commit's first parent (${parents[0]}) doesn't match pre-merge HEAD (${preMergeHead})`,
        });
        return;
      }

      // 13) Push. `--no-verify` for the same reason as the commit step: the
      // user's pre-push hook chain (rubocop / sorbet / etc.) isn't reachable
      // from a fresh worktree's PATH/gem env. `HEAD:<headRef>` because the
      // local branch we're on is a connor-review-* ephemeral; the upstream
      // ref is still the PR's actual branch.
      try {
        await gitExec(['push', '--no-verify', 'origin', `HEAD:${headRef}`], { cwd: worktreePath });
      } catch (e) {
        const stderr = e instanceof GitCliError ? e.stderr : (e as Error).message;
        reply.code(502).send({ code: 'PUSH_FAILED', message: `git push failed: ${stderr.trim()}`, stderr });
        return;
      }

      // Bust the meta cache so the next /api/pulls/... fetch reflects the
      // newly-clean mergeable state.
      metaCache.delete(metaKey(params));
      reply.send({ ok: true, commitSha });
    } catch (e) {
      if (e instanceof GitCliError) {
        reply.code(502).send({ code: 'MERGE_FAILED', message: e.message, stderr: e.stderr });
        return;
      }
      throw e;
    } finally {
      await cleanup();
    }
  });

  // Ask Claude to fix the PR's failing CI builds locally and push the
  // result. Mirrors the resolve-conflicts route's pattern: throwaway
  // worktree, safety-bounded prompt, --no-verify commit + push. Different
  // failure mode: instead of mechanical conflict resolution we let Claude
  // iterate on real test code, so the tool allow-list is broader (Bash,
  // Write, Grep, Glob) and we pre-run dependency installs so tests can
  // actually execute.
  app.post<{
    Params: { owner: string; repo: string; number: string };
    Body: { repoPath?: string };
  }>('/api/pulls/:owner/:repo/:number/fix-ci', async (req, reply) => {
    const params = parsePullParams(req.params);
    const repoPath = (req.body?.repoPath ?? '').trim();
    if (!repoPath) {
      reply.code(400).send({ code: 'BAD_REPO_PATH', message: 'repoPath is required (configure localRepos for this repo)' });
      return;
    }
    let absRepoPath: string;
    try {
      const abs = resolvePath(repoPath);
      if (!existsSync(abs) || !statSync(abs).isDirectory() || !existsSync(resolvePath(abs, '.git'))) {
        reply.code(400).send({ code: 'BAD_REPO_PATH', message: `Not a git checkout: ${abs}` });
        return;
      }
      absRepoPath = abs;
    } catch (e) {
      reply.code(400).send({ code: 'BAD_REPO_PATH', message: (e as Error).message });
      return;
    }

    // Fetch fresh meta to make sure we operate on the PR's *current* head
    // commit — stale rollup data could make us run Claude on already-fixed
    // builds.
    metaCache.delete(metaKey(params));
    const meta = await fetchMeta(params.owner, params.repo, params.number);
    const failing = (meta.ciContexts ?? []).filter((c) => c.isFailure);
    // One UUID identifies this run across every telemetry milestone. Emits
    // are fire-and-forget — see `lib/fixCiTelemetry.ts` for the contract.
    const runId = randomUUID();
    const startedAt = Date.now();
    if (failing.length === 0) {
      void emitFixCiEvent({
        runId, kind: 'finished',
        owner: params.owner, repo: params.repo, number: params.number,
        head_sha: meta.headSha,
        prompt_version: FIX_CI_PROMPT_VERSION,
        status: 'no_failures',
        total_ms: Date.now() - startedAt,
      });
      reply.send({ ok: true, noFailures: true });
      return;
    }
    void emitFixCiEvent({
      runId, kind: 'started',
      owner: params.owner, repo: params.repo, number: params.number,
      head_sha: meta.headSha,
      failing_checks: failing.map((c) => ({ name: c.name, state: c.state, url: c.url })),
      prompt_version: FIX_CI_PROMPT_VERSION,
    });
    const baseRef = meta.baseRefName;
    const headRef = meta.headRefName;
    const remoteHead = `origin/${headRef}`;
    const stamp = Date.now();
    const worktreePath = resolvePath(tmpdir(),
      `connor-review-fix-ci-${params.owner}-${params.repo}-${params.number}-${stamp}`);
    // Ephemeral local branch — see resolve-conflicts above for rationale.
    // If the PR's actual branch is already checked out in another worktree
    // (~/.work/worktrees/... is common), `git worktree add -B <branch>`
    // refuses; using a unique name dodges that completely.
    const tempBranch = `connor-review-fix-ci-${params.number}-${stamp}`;

    const cleanup = async () => {
      try { await gitExec(['worktree', 'remove', '--force', worktreePath], { cwd: absRepoPath }); } catch (e) {
        try {
          if (existsSync(worktreePath)) {
            const { rmSync } = await import('node:fs');
            rmSync(worktreePath, { recursive: true, force: true });
          }
        } catch { /* give up */ }
        console.warn(`[fix-ci] worktree cleanup failed for ${worktreePath}:`, (e as Error).message);
      }
      try { await gitExec(['branch', '-D', tempBranch], { cwd: absRepoPath }); } catch { /* not created or already gone */ }
    };

    try {
      // 1) Fetch + worktree.
      await gitExec(['fetch', 'origin', baseRef, headRef], { cwd: absRepoPath });
      await gitExec(['worktree', 'add', '-B', tempBranch, worktreePath, remoteHead], { cwd: absRepoPath });

      // 2) Prep step: install dependencies in the worktree. Pre-running these
      // makes a huge difference — Claude otherwise wastes time (and timeout)
      // re-running them itself, and sometimes hangs on interactive prompts.
      // Each install gets a generous timeout because the first run after a
      // worktree create has no cached gems/node_modules.
      const hasGemfile = existsSync(resolvePath(worktreePath, 'Gemfile'));
      const hasPackageJson = existsSync(resolvePath(worktreePath, 'package.json'));
      const hasYarnLock = existsSync(resolvePath(worktreePath, 'yarn.lock'));
      const { execFile } = await import('node:child_process');
      // Use the user's login shell so per-project tool managers (mise / rbenv
      // / nvm / volta / asdf) activate before we run `bundle` / `yarn`. Without
      // this, Node's spawned env has a minimal PATH and `bundle install`
      // fails with "command not found" or picks the wrong Ruby. `-l` sources
      // login files; `-i` sources interactive files (.zshrc / .bashrc), which
      // is where most tool managers register themselves on macOS.
      const userShell = process.env.SHELL ?? '/bin/zsh';
      // mise refuses to load configs in unknown paths and aborts the
      // surrounding command — every fresh worktree under /tmp counts as
      // "unknown". Pre-trust this run's worktree via the env var so the
      // install passes without mutating the user's persistent trust store.
      // Honours their existing trusted paths too.
      const trustedPaths = [worktreePath, process.env.MISE_TRUSTED_CONFIG_PATHS].filter(Boolean).join(':');
      const childEnv = {
        ...process.env,
        MISE_TRUSTED_CONFIG_PATHS: trustedPaths,
        // yarn classic and npm interactive prompts (e.g. "Are you sure you
        // want to overwrite…?") can hang the install. CI=1 + the explicit
        // env vars below make every tool we shell out to assume it's running
        // headless and skip prompts.
        CI: '1',
        YARN_ENABLE_HARDENED_MODE: '0',
        FORCE_COLOR: '0',
        npm_config_yes: 'true',
      };
      const runShell = (cmd: string, label: string, timeoutMs: number): Promise<void> => {
        return new Promise((res, rej) => {
          // `-il` keeps the env close to a real terminal so mise/rbenv hooks
          // fire. Stdin is closed below so even an interactive shell can't
          // hang waiting for input.
          const child = execFile(userShell, ['-ilc', cmd], { cwd: worktreePath, env: childEnv, timeout: timeoutMs, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
              const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed;
              const exitCode = (err as NodeJS.ErrnoException & { code?: number | string }).code;
              // Combine stdout + stderr so we see the real error even when the
              // tool prints failures to stdout (yarn 1 does this with --silent;
              // sorbet does it too). Keep the last 2000 chars of each.
              const stderrTail = (stderr?.toString().trim() ?? '').slice(-2000);
              const stdoutTail = (stdout?.toString().trim() ?? '').slice(-2000);
              const tail = [stderrTail && `stderr:\n${stderrTail}`, stdoutTail && `stdout:\n${stdoutTail}`].filter(Boolean).join('\n\n');
              const explanation = killed
                ? 'timed out'
                : typeof exitCode === 'number'
                  ? `exited ${exitCode}`
                  : 'failed';
              rej(new Error(`${label} ${explanation}\n  cmd: ${cmd}\n${tail || (err as Error).message}`));
              return;
            }
            res();
          });
          child.stdin?.end();
        });
      };
      const installErrors: string[] = [];
      const installStartedAt = Date.now();
      if (hasGemfile) {
        try { await runShell('bundle install --quiet', 'bundle install', 15 * 60_000); }
        catch (e) { installErrors.push((e as Error).message); }
      }
      if (hasPackageJson) {
        // Dropped `--silent` — it swallowed the actual yarn error in the
        // user's last attempt and left us with no signal. yarn classic and
        // berry both accept plain `yarn install` (no flags), so use that.
        // CI=1 (above) is what makes yarn pick its non-interactive mode.
        const installCmd = hasYarnLock
          ? 'yarn install'
          : 'npm install --no-audit --no-fund';
        try { await runShell(installCmd, 'yarn/npm install', 15 * 60_000); }
        catch (e) { installErrors.push((e as Error).message); }
      }
      const installMs = Date.now() - installStartedAt;
      void emitFixCiEvent({
        runId, kind: 'install_done',
        install_ms: installMs,
        install_failed: installErrors.length > 0,
        install_error: installErrors.length > 0 ? installErrors.join('\n\n') : undefined,
      });
      if (installErrors.length > 0) {
        void emitFixCiEvent({
          runId, kind: 'finished',
          status: 'install_failed',
          error: installErrors.join('\n\n').slice(0, 2000),
          total_ms: Date.now() - startedAt,
        });
        reply.code(502).send({
          code: 'INSTALL_FAILED',
          message: `Dependency install failed in the worktree — Claude can't run tests without it.`,
          details: installErrors,
        });
        return;
      }

      // 3) Build the prompt. The failing-check list is the key signal —
      // Claude uses the names to figure out which tests / linters to run.
      // The prompt body lives in `server/src/prompts/fixCi.v1.ts` (and
      // sibling files for later versions) so we can iterate on it and tag
      // every telemetry event with the version that ran.
      const prompt = getFixCiPrompt(FIX_CI_PROMPT_VERSION)({
        owner: params.owner,
        repo: params.repo,
        number: params.number,
        title: meta.title,
        authorLogin: meta.authorLogin,
        headRef,
        baseRef,
        headSha: meta.headSha,
        worktreePath,
        failing: failing.map((c) => ({ name: c.name, state: c.state, url: c.url })),
      });

      // 4) Run Claude. Long timeout (30 min) because test iteration on a
      // big repo can take a while.
      const claudeStartedAt = Date.now();
      let claudeOutput = '';
      try {
        claudeOutput = await claudeExec(prompt, {
          cwd: worktreePath,
          allowedTools: ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob', 'LS'],
          permissionMode: 'acceptEdits',
          timeoutMs: 30 * 60_000,
        });
        void emitFixCiEvent({
          runId, kind: 'claude_done',
          claude_ms: Date.now() - claudeStartedAt,
          claude_failed: false,
        });
      } catch (e) {
        const claudeMs = Date.now() - claudeStartedAt;
        if (e instanceof ClaudeCliError) {
          void emitFixCiEvent({
            runId, kind: 'claude_done',
            claude_ms: claudeMs,
            claude_failed: true,
            claude_error: e.code,
            stderr_tail: (e.stderr ?? '').slice(-2000),
          });
          void emitFixCiEvent({
            runId, kind: 'finished',
            status: 'claude_failed',
            abort_code: e.code,
            error: e.message,
            stderr_tail: (e.stderr ?? '').slice(-2000),
            total_ms: Date.now() - startedAt,
          });
          const status = e.code === 'CLAUDE_NOT_INSTALLED' ? 502 : e.code === 'TIMEOUT' ? 504 : 500;
          reply.code(status).send({ code: e.code, message: e.message, stderr: e.stderr });
          return;
        }
        throw e;
      }

      // 4.25) Triage branch: if Claude decided the failures aren't this PR's
      // fault, it outputs the sentinel `<<UNRELATED_REBASE>>`. The wrapper
      // then rebases the PR branch onto its base and force-with-lease-pushes,
      // so CI re-runs against an up-to-date base. No commit, no merge-conflict
      // resolution — if the rebase isn't clean we abort and surface the
      // conflict to the user.
      const UNRELATED_REBASE_SENTINEL = '<<UNRELATED_REBASE>>';
      if (claudeOutput.includes(UNRELATED_REBASE_SENTINEL)) {
        // Discard any tracked-file edits Claude may have made despite the
        // prompt telling it not to. The worktree is ephemeral so this is safe.
        try { await gitExec(['checkout', '--', '.'], { cwd: worktreePath }); } catch { /* nothing to revert */ }

        // Re-fetch the freshest base before rebasing — the install step takes
        // a while and the base may have moved since the initial fetch at the
        // top of the route.
        try {
          await gitExec(['fetch', 'origin', baseRef], { cwd: worktreePath });
        } catch (e) {
          const stderr = e instanceof GitCliError ? e.stderr : (e as Error).message;
          void emitFixCiEvent({
            runId, kind: 'finished',
            status: 'rebase_conflicts',
            abort_code: 'FETCH_BASE_FAILED',
            error: 'FETCH_BASE_FAILED',
            stderr_tail: (stderr ?? '').slice(-2000),
            total_ms: Date.now() - startedAt,
          });
          reply.code(502).send({ code: 'FETCH_BASE_FAILED', message: `git fetch origin ${baseRef} failed: ${stderr.trim()}`, stderr });
          return;
        }

        try {
          await gitExec(['rebase', `origin/${baseRef}`], { cwd: worktreePath });
        } catch (e) {
          const stderr = e instanceof GitCliError ? e.stderr : (e as Error).message;
          // Always abort so the worktree is in a clean state for cleanup().
          try { await gitExec(['rebase', '--abort'], { cwd: worktreePath }); } catch { /* nothing in progress */ }
          void emitFixCiEvent({
            runId, kind: 'finished',
            status: 'rebase_conflicts',
            abort_code: 'REBASE_CONFLICTS',
            error: 'REBASE_CONFLICTS',
            stderr_tail: (stderr ?? '').slice(-2000),
            total_ms: Date.now() - startedAt,
          });
          reply.code(409).send({
            code: 'REBASE_CONFLICTS',
            message: `Claude flagged the failures as unrelated, but rebasing onto ${baseRef} produced conflicts — resolve manually.`,
            stderr,
          });
          return;
        }

        const rebasedSha = (await gitExec(['rev-parse', 'HEAD'], { cwd: worktreePath })).trim();

        // --force-with-lease guards against a teammate having pushed to the PR
        // branch since we started — we pin to the head SHA we observed at the
        // top of the route. If the remote moved, the push fails safely.
        try {
          await gitExec(
            ['push', `--force-with-lease=${headRef}:${meta.headSha}`, '--no-verify', 'origin', `HEAD:${headRef}`],
            { cwd: worktreePath },
          );
        } catch (e) {
          const stderr = e instanceof GitCliError ? e.stderr : (e as Error).message;
          void emitFixCiEvent({
            runId, kind: 'finished',
            status: 'push_failed',
            abort_code: 'PUSH_FAILED_REBASE',
            error: 'PUSH_FAILED_REBASE',
            stderr_tail: (stderr ?? '').slice(-2000),
            total_ms: Date.now() - startedAt,
          });
          reply.code(502).send({ code: 'PUSH_FAILED', message: `git push (rebase) failed: ${stderr.trim()}`, stderr });
          return;
        }

        metaCache.delete(metaKey(params));
        void emitFixCiEvent({
          runId, kind: 'finished',
          status: 'success_rebased',
          pushed_sha: rebasedSha,
          total_ms: Date.now() - startedAt,
        });
        reply.send({ ok: true, rebased: true, unrelated: true, commitSha: rebasedSha });
        return;
      }

      // 4.5) Revert any lockfile changes the install step may have produced.
      // `bundle install` and `yarn install` routinely rewrite their lockfiles
      // (BUNDLED WITH version, platform pins, etc.) when they run in a fresh
      // worktree. We pre-install deps to give Claude something to test
      // against — but the resulting lockfile noise should never enter a
      // fix-CI commit. By reverting them here (before `git add`), only
      // Claude's actual code edits can make it into the commit.
      //
      // If Claude legitimately needed to update a lockfile to fix CI, that
      // intent is deliberately dropped here — lockfile changes belong in
      // their own dedicated PR, not buried inside an auto-generated test fix.
      const LOCKFILES = ['Gemfile.lock', 'yarn.lock', 'package-lock.json', 'pnpm-lock.yaml', 'bun.lockb'];
      const presentLockfiles = LOCKFILES.filter((f) => existsSync(resolvePath(worktreePath, f)));
      if (presentLockfiles.length > 0) {
        try {
          await gitExec(['checkout', 'HEAD', '--', ...presentLockfiles], { cwd: worktreePath });
        } catch (e) {
          // Not fatal — a lockfile path missing from HEAD is fine (newly
          // added by Claude is rare but possible).
          console.warn(`[fix-ci] couldn't revert lockfiles:`, (e as Error).message);
        }
      }

      // 5) Was there any change to commit?
      const statusOut = await gitExec(['status', '--porcelain', '-z'], { cwd: worktreePath });
      const hasChanges = statusOut.split('\0').filter(Boolean).length > 0;
      if (!hasChanges) {
        void emitFixCiEvent({
          runId, kind: 'finished',
          status: 'no_changes',
          total_ms: Date.now() - startedAt,
        });
        reply.send({ ok: true, noChanges: true });
        return;
      }

      // 6) Stage everything Claude touched. `git add -A` here is intentional
      // — unlike resolve-conflicts, fix-ci legitimately spans whatever files
      // a real test fix requires, and the worktree only contains Claude's
      // own diff (we don't mix in any merge-staged content). Safety net: the
      // user reviews the commit on GitHub.
      await gitExec(['add', '-A'], { cwd: worktreePath });
      await gitExec(['commit', '--no-verify', '-m', `Fix failing CI builds (${failing.length} check${failing.length === 1 ? '' : 's'})`], { cwd: worktreePath });

      const commitSha = (await gitExec(['rev-parse', 'HEAD'], { cwd: worktreePath })).trim();

      // Surface the files in the commit so the client can show what changed.
      const filesChangedRaw = (await gitExec(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], { cwd: worktreePath })).trim();
      const filesChanged = filesChangedRaw.split('\n').map((s) => s.trim()).filter(Boolean);

      // 7) Push. `HEAD:<headRef>` — the local branch we're on is a
      // connor-review-* ephemeral; the upstream branch we update is still
      // the PR's actual branch.
      try {
        await gitExec(['push', '--no-verify', 'origin', `HEAD:${headRef}`], { cwd: worktreePath });
      } catch (e) {
        const stderr = e instanceof GitCliError ? e.stderr : (e as Error).message;
        void emitFixCiEvent({
          runId, kind: 'finished',
          status: 'push_failed',
          error: 'PUSH_FAILED',
          stderr_tail: (stderr ?? '').slice(-2000),
          total_ms: Date.now() - startedAt,
        });
        reply.code(502).send({ code: 'PUSH_FAILED', message: `git push failed: ${stderr.trim()}`, stderr });
        return;
      }

      metaCache.delete(metaKey(params));
      void emitFixCiEvent({
        runId, kind: 'finished',
        status: 'success_pushed',
        pushed_sha: commitSha,
        files_changed: filesChanged,
        failing_checks_fixed: failing.map((c) => c.name),
        total_ms: Date.now() - startedAt,
      });
      reply.send({ ok: true, commitSha, filesChanged, failingChecksFixed: failing.map((c) => c.name) });
    } catch (e) {
      if (e instanceof GitCliError) {
        void emitFixCiEvent({
          runId, kind: 'finished',
          status: 'safety_aborted',
          abort_code: 'GIT_CLI_ERROR',
          error: e.message,
          stderr_tail: (e.stderr ?? '').slice(-2000),
          total_ms: Date.now() - startedAt,
        });
        reply.code(502).send({ code: 'FIX_FAILED', message: e.message, stderr: e.stderr });
        return;
      }
      throw e;
    } finally {
      await cleanup();
    }
  });
}
