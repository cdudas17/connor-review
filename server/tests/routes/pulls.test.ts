import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildServer } from '../../src/index.js';

vi.mock('../../src/lib/ghExec.js', () => {
  const ghExec = vi.fn();
  class GhCliError extends Error {
    override readonly name = 'GhCliError';
    constructor(public code: string, message: string, public stderr: string) {
      super(message);
    }
  }
  return { ghExec, GhCliError };
});

import { ghExec, GhCliError } from '../../src/lib/ghExec.js';
const mocked = ghExec as unknown as ReturnType<typeof vi.fn>;

const PR_GRAPHQL_RESPONSE = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        id: 'PR_abc',
        number: 1,
        title: 'Test PR',
        author: { login: 'octocat' },
        state: 'OPEN',
        merged: false,
        isDraft: false,
        reviewDecision: 'REVIEW_REQUIRED',
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'sha-1',
        url: 'https://github.com/Gusto/zenpayroll/pull/1',
        viewerLatestReview: null,
        commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
        reviewThreads: { nodes: [] },
      },
    },
  },
});

const DIFF_RESPONSE = `diff --git a/file.txt b/file.txt\nindex 0..1 100644\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n`;

describe('pulls routes', () => {
  beforeEach(() => mocked.mockReset());

  it('GET /api/pulls/:o/:r/:n returns parsed PR meta + caches by headSha', async () => {
    mocked.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    const app = await buildServer();
    const first = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1' });
    expect(first.statusCode).toBe(200);
    const body = first.json();
    expect(body.id).toBe('PR_abc');
    expect(body.headSha).toBe('sha-1');
    expect(body.reviewThreads).toEqual([]);

    const second = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1' });
    expect(second.statusCode).toBe(200);
    expect(mocked).toHaveBeenCalledTimes(1); // cache hit on second call

    await app.close();
  });

  it('GET ?fresh=1 bypasses the meta cache', async () => {
    mocked.mockResolvedValue(PR_GRAPHQL_RESPONSE);
    const app = await buildServer();
    await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1' });
    await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1?fresh=1' });
    expect(mocked).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('GET /diff returns unified diff text', async () => {
    mocked.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE); // for meta-fetch to get headSha
    mocked.mockResolvedValueOnce(DIFF_RESPONSE);
    const app = await buildServer();
    const res = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1/diff' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.body).toContain('diff --git');
    await app.close();
  });

  it('POST /reviews calls addPullRequestReview with threads via stdin', async () => {
    mocked.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { addPullRequestReview: { pullRequestReview: { id: 'R_1', state: 'APPROVED' } } } }));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/reviews',
      payload: {
        event: 'APPROVE',
        body: 'lgtm',
        threads: [
          { path: 'file.txt', line: 2, side: 'RIGHT', body: 'nit' },
          { path: 'file.txt', line: 8, side: 'RIGHT', startLine: 5, startSide: 'RIGHT', body: 'these lines look off' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'R_1', state: 'APPROVED' });
    const lastCallArgs = mocked.mock.calls.at(-1)![0] as string[];
    const lastCallOpts = mocked.mock.calls.at(-1)![1] as { input?: string } | undefined;
    expect(lastCallArgs).toEqual(['api', 'graphql', '--input', '-']);
    const body = JSON.parse(lastCallOpts!.input!);
    expect(body.variables.pullRequestId).toBe('PR_abc');
    expect(body.variables.event).toBe('APPROVE');
    expect(body.variables.body).toBe('lgtm');
    expect(body.variables.threads).toEqual([
      { path: 'file.txt', body: 'nit', line: 2, side: 'RIGHT' },
      { path: 'file.txt', body: 'these lines look off', line: 8, side: 'RIGHT', startLine: 5, startSide: 'RIGHT' },
    ]);
    await app.close();
  });

  it('POST /reviews with event=PENDING reuses an existing pending review (no double-create)', async () => {
    // Meta lookup says the viewer already has a pending review.
    const metaWithPending = JSON.parse(PR_GRAPHQL_RESPONSE);
    metaWithPending.data.repository.pullRequest.viewerLatestReview = { id: 'R_existing', state: 'PENDING' };
    mocked.mockResolvedValueOnce(JSON.stringify(metaWithPending));
    // The follow-up addThread mutation succeeds.
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { addPullRequestReviewThread: { thread: { id: 'TH_x' } } } }));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/reviews',
      payload: { event: 'PENDING', threads: [{ path: 'f', line: 1, side: 'RIGHT', body: 'x' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'R_existing', state: 'PENDING' });
    // No addPullRequestReview call should have been made — only meta + thread.
    expect(mocked).toHaveBeenCalledTimes(2);
    const lastInput = JSON.parse((mocked.mock.calls.at(-1)![1] as { input?: string }).input!);
    expect(lastInput.variables.pullRequestReviewId).toBe('R_existing');
    await app.close();
  });

  it('POST /reviews with event=COMMENT and an existing pending review submits the pending review (no parallel create)', async () => {
    // Scenario: user has a leftover pending review (e.g. from a prior "Add to review")
    // and clicks the top-level Comment button. GitHub rejects parallel reviews, so we
    // should submit the pending one with the user's body text instead.
    const metaWithPending = JSON.parse(PR_GRAPHQL_RESPONSE);
    metaWithPending.data.repository.pullRequest.viewerLatestReview = { id: 'R_pending', state: 'PENDING' };
    mocked.mockResolvedValueOnce(JSON.stringify(metaWithPending));
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { submitPullRequestReview: { pullRequestReview: { id: 'R_pending', state: 'COMMENTED' } } } }));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/reviews',
      payload: { event: 'COMMENT', body: 'nits in line' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'R_pending', state: 'COMMENTED' });
    // Confirm we hit submitPullRequestReview, not addPullRequestReview.
    expect(mocked).toHaveBeenCalledTimes(2);
    const lastInput = JSON.parse((mocked.mock.calls.at(-1)![1] as { input?: string }).input!);
    expect(lastInput.query).toMatch(/submitPullRequestReview/);
    expect(lastInput.variables.pullRequestReviewId).toBe('R_pending');
    expect(lastInput.variables.event).toBe('COMMENT');
    expect(lastInput.variables.body).toBe('nits in line');
    await app.close();
  });

  it('POST /reviews with event=PENDING creates a pending review', async () => {
    mocked.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { addPullRequestReview: { pullRequestReview: { id: 'R_pending', state: 'PENDING' } } } }));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/reviews',
      payload: { event: 'PENDING', threads: [{ path: 'file.txt', line: 2, side: 'RIGHT', body: 'wip' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'R_pending', state: 'PENDING' });
    // PullRequestReviewEvent! enum rejects 'PENDING' — the variable must be omitted
    // entirely to create a draft review.
    const lastCallOpts = mocked.mock.calls.at(-1)![1] as { input?: string } | undefined;
    const sentBody = JSON.parse(lastCallOpts!.input!);
    expect(sentBody.variables.event).toBeUndefined();
    expect('event' in sentBody.variables).toBe(false);
    await app.close();
  });

  it('POST /threads creates a standalone thread when no review id is provided', async () => {
    mocked.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { addPullRequestReviewThread: { thread: { id: 'TH_1' } } } }));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/threads',
      payload: { path: 'file.txt', line: 5, side: 'RIGHT', body: 'looks good' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'TH_1' });
    const lastCallOpts = mocked.mock.calls.at(-1)![1] as { input?: string } | undefined;
    const body = JSON.parse(lastCallOpts!.input!);
    expect(body.variables.pullRequestId).toBe('PR_abc');
    expect(body.variables.path).toBe('file.txt');
    expect(body.variables.line).toBe(5);
    expect(body.variables.side).toBe('RIGHT');
    expect(body.variables.pullRequestReviewId).toBeUndefined();
    await app.close();
  });

  it('POST /threads attaches to a pending review when reviewId is provided', async () => {
    mocked.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { addPullRequestReviewThread: { thread: { id: 'TH_2' } } } }));
    const app = await buildServer();
    await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/threads',
      payload: { path: 'file.txt', line: 5, side: 'RIGHT', body: 'looks good', pullRequestReviewId: 'R_pending' },
    });
    const lastCallOpts = mocked.mock.calls.at(-1)![1] as { input?: string } | undefined;
    const body = JSON.parse(lastCallOpts!.input!);
    expect(body.variables.pullRequestReviewId).toBe('R_pending');
    await app.close();
  });

  it('POST /reviews/:reviewId/submit submits the pending review', async () => {
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { submitPullRequestReview: { pullRequestReview: { id: 'R_pending', state: 'APPROVED' } } } }));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/reviews/R_pending/submit',
      payload: { event: 'APPROVE', body: 'done' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'R_pending', state: 'APPROVED' });
    const lastCallOpts = mocked.mock.calls.at(-1)![1] as { input?: string } | undefined;
    const body = JSON.parse(lastCallOpts!.input!);
    expect(body.variables.pullRequestReviewId).toBe('R_pending');
    expect(body.variables.event).toBe('APPROVE');
    expect(body.variables.body).toBe('done');
    await app.close();
  });

  it('POST /labels attaches labels via the REST issues API', async () => {
    mocked.mockResolvedValueOnce(JSON.stringify([{ name: 'Comments left by reviewer' }]));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/labels',
      payload: { labels: ['Comments left by reviewer'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    const callArgs = mocked.mock.calls[0][0] as string[];
    expect(callArgs).toContain('repos/Gusto/zenpayroll/issues/1/labels');
    expect(callArgs).toContain('POST');
    const callOpts = mocked.mock.calls[0][1] as { input?: string } | undefined;
    expect(JSON.parse(callOpts!.input!)).toEqual({ labels: ['Comments left by reviewer'] });
    await app.close();
  });

  it('POST /labels returns 400 when labels is empty', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/labels',
      payload: { labels: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_PARAMS');
    await app.close();
  });

  it('POST /threads/:id/reply calls the reply mutation', async () => {
    mocked.mockResolvedValueOnce(JSON.stringify({ data: { addPullRequestReviewThreadReply: { comment: { id: 'C_1', body: 'ack' } } } }));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/threads/THREAD_1/reply',
      payload: { body: 'ack' },
    });
    expect(res.statusCode).toBe(200);
    const call = mocked.mock.calls.at(-1)![0] as string[];
    expect(call.join(' ')).toContain('pullRequestReviewThreadId=THREAD_1');
    await app.close();
  });

  it('returns 400 on invalid params', async () => {
    const app = await buildServer();
    const res = await app.inject({ url: '/api/pulls/bad owner/repo/abc' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_PARAMS');
    await app.close();
  });

  it('returns 401 when ghExec throws AUTH_REQUIRED', async () => {
    mocked.mockRejectedValueOnce(new GhCliError('AUTH_REQUIRED', 'need login', 'gh auth login required'));
    const app = await buildServer();
    const res = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1' });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('AUTH_REQUIRED');
    await app.close();
  });

  describe('GET /api/pulls/:o/:r/:n/files/content', () => {
    it('400 when path or ref is missing', async () => {
      const app = await buildServer();
      const r1 = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1/files/content?ref=main' });
      expect(r1.statusCode).toBe(400);
      const r2 = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1/files/content?path=a.rb' });
      expect(r2.statusCode).toBe(400);
      await app.close();
    });

    it('shells out to gh api contents and base64-decodes the response', async () => {
      const source = "def hello\n  'world'\nend\n";
      mocked.mockResolvedValueOnce(Buffer.from(source).toString('base64') + '\n');
      const app = await buildServer();
      const res = await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1/files/content?path=lib/x.rb&ref=main' });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.body).toBe(source);
      const args = mocked.mock.calls[0][0] as string[];
      expect(args[0]).toBe('api');
      expect(args[1]).toContain('repos/Gusto/zenpayroll/contents/');
      expect(args[1]).toContain('lib%2Fx.rb');
      expect(args[1]).toContain('ref=main');
      await app.close();
    });

    it('URL-encodes path segments containing special chars', async () => {
      mocked.mockResolvedValueOnce(Buffer.from('').toString('base64'));
      const app = await buildServer();
      await app.inject({ url: '/api/pulls/Gusto/zenpayroll/1/files/content?path=path%20with%20space.rb&ref=feature%2Fx' });
      const args = mocked.mock.calls[0][0] as string[];
      expect(args[1]).toContain('path%20with%20space.rb');
      expect(args[1]).toContain('ref=feature%2Fx');
      await app.close();
    });
  });
});
