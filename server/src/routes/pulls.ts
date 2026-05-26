import type { FastifyInstance } from 'fastify';
import { ghExec, GhCliError } from '../lib/ghExec.js';
import { LRUCache } from '../lib/lruCache.js';
import { BadParamsError, parsePullParams } from '../lib/parseRouteParams.js';
import { extractBuildkiteZenpayrollUrl } from '../lib/ciUrl.js';
import { PULL_REQUEST_QUERY } from '../queries/pullRequest.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_MUTATION } from '../queries/addPullRequestReview.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_THREAD_MUTATION } from '../queries/addPullRequestReviewThread.graphql.js';
import { ADD_PULL_REQUEST_REVIEW_THREAD_REPLY_MUTATION } from '../queries/addPullRequestReviewThreadReply.graphql.js';
import { SUBMIT_PULL_REQUEST_REVIEW_MUTATION } from '../queries/submitPullRequestReview.graphql.js';

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
  reviewThreads: ReviewThread[];
}

interface PRLabel { name: string; color: string; }
interface PRAssignee { login: string; avatarUrl: string | null; url: string | null; }

interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  comments: Array<{ id: string; authorLogin: string | null; authorAvatarUrl: string | null; body: string; createdAt: string; diffHunk: string | null }>;
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
    ciUrl: extractBuildkiteZenpayrollUrl(pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
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
      const status = err.code === 'AUTH_REQUIRED' ? 401 : err.code === 'GH_API_ERROR' ? 502 : 500;
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
    const cached = metaCache.get(metaKey(params));
    // Always refresh meta when creating a PENDING review — `viewerPendingReviewId` can
    // shift if the user just submitted/started a review elsewhere.
    const meta = req.body.event === 'PENDING'
      ? await fetchMeta(params.owner, params.repo, params.number)
      : (cached ?? (await fetchMeta(params.owner, params.repo, params.number)));
    metaCache.set(metaKey(params), meta);

    // If the viewer already has a pending review on this PR and we're being asked to
    // start a new pending review, attach the threads to the existing review instead.
    if (req.body.event === 'PENDING' && meta.viewerPendingReviewId) {
      const reviewId = meta.viewerPendingReviewId;
      for (const t of req.body.threads ?? []) {
        const tv = toThreadVariable(t);
        await ghExec(['api', 'graphql', '--input', '-'], {
          input: JSON.stringify({
            query: ADD_PULL_REQUEST_REVIEW_THREAD_MUTATION,
            variables: { ...tv, pullRequestId: meta.id, pullRequestReviewId: reviewId },
          }),
        });
      }
      return { id: reviewId, state: 'PENDING' };
    }

    const variables: Record<string, unknown> = {
      pullRequestId: meta.id,
      event: req.body.event,
    };
    if (req.body.body) variables.body = req.body.body;
    if (req.body.threads?.length) {
      variables.threads = req.body.threads.map(toThreadVariable);
    }

    try {
      const out = await ghExec(['api', 'graphql', '--input', '-'], {
        input: JSON.stringify({ query: ADD_PULL_REQUEST_REVIEW_MUTATION, variables }),
      });
      const parsed = JSON.parse(out) as { data?: { addPullRequestReview?: { pullRequestReview?: { id: string; state: string } } } };
      const review = parsed.data?.addPullRequestReview?.pullRequestReview;
      if (!review) throw new Error('Review creation returned no review');
      return review;
    } catch (err) {
      // Race: another process started a pending review between our meta fetch and the
      // mutation. Re-fetch and attach threads to the now-existing pending review.
      const isOnePendingErr = err instanceof GhCliError && /one pending review/i.test(err.stderr);
      if (req.body.event === 'PENDING' && isOnePendingErr) {
        const fresh = await fetchMeta(params.owner, params.repo, params.number);
        metaCache.set(metaKey(params), fresh);
        if (fresh.viewerPendingReviewId) {
          for (const t of req.body.threads ?? []) {
            const tv = toThreadVariable(t);
            await ghExec(['api', 'graphql', '--input', '-'], {
              input: JSON.stringify({
                query: ADD_PULL_REQUEST_REVIEW_THREAD_MUTATION,
                variables: { ...tv, pullRequestId: fresh.id, pullRequestReviewId: fresh.viewerPendingReviewId },
              }),
            });
          }
          return { id: fresh.viewerPendingReviewId, state: 'PENDING' };
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
}
