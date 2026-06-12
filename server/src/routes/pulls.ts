import type { FastifyInstance } from 'fastify';
import { ghExec, GhCliError } from '../lib/ghExec.js';
import { LRUCache } from '../lib/lruCache.js';
import { BadParamsError, parsePullParams } from '../lib/parseRouteParams.js';
import { extractBuildkiteCheckUrl } from '../lib/ciUrl.js';
import { PULL_REQUEST_QUERY } from '../queries/pullRequest.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_MUTATION } from '../queries/addPullRequestReview.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_THREAD_MUTATION } from '../queries/addPullRequestReviewThread.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_THREAD_REPLY_MUTATION } from '../queries/addPullRequestReviewThreadReply.graphql.js';
import { SUBMIT_PULL_REQUEST_REVIEW_MUTATION } from '../queries/submitPullRequestReview.graphql.js';
import { MARK_READY_FOR_REVIEW_MUTATION } from '../queries/markReadyForReview.graphql.js';
import { claudeExec, ClaudeCliError } from '../lib/claudeExec.js';
import { existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

type CiStatus = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;

interface PullRequestMeta {
  id: string;
  number: number;
  title: string;
  authorLogin: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  isDraft: boolean;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  ciStatus: CiStatus;
  /** URL of the buildkite/zenpayroll check, if it exists on this PR. */
  ciUrl: string | null;
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
  reviewThreads: ReviewThread[];
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
    reviewDecision: pr.reviewDecision ?? null,
    ciStatus: (pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null) as CiStatus,
    ciUrl: extractBuildkiteCheckUrl(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
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
}
