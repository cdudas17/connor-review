import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/lib/gitExec.js', () => {
  const gitExec = vi.fn();
  class GitCliError extends Error {
    override readonly name = 'GitCliError';
    constructor(public code: string, message: string, public stderr: string) {
      super(message);
    }
  }
  return { gitExec, GitCliError };
});

import { buildServer } from '../../src/index.js';
import { gitExec } from '../../src/lib/gitExec.js';
import { __resetLocalRouteCaches } from '../../src/routes/local.js';

const mocked = gitExec as unknown as ReturnType<typeof vi.fn>;

describe('local routes', () => {
  let tmp = '';
  beforeEach(async () => {
    mocked.mockReset();
    __resetLocalRouteCaches();
    // Make a fake repo dir so validateRepoPath() lets us through.
    tmp = await fs.mkdtemp(join(tmpdir(), 'cr-local-test-'));
    await fs.mkdir(join(tmp, '.git'));
  });
  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('GET /api/local/meta returns synthetic PR meta from git log', async () => {
    // rev-parse, then log -1
    mocked.mockResolvedValueOnce('abc1234567890\n');
    mocked.mockResolvedValueOnce('Refactor the widget\nConnor\n2026-06-08T10:11:12-07:00\n');
    const app = await buildServer();
    const res = await app.inject({ url: `/api/local/meta?repo=zenpayroll&path=${encodeURIComponent(tmp)}&branch=feature/foo` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toBe('local');
    expect(body.localRepo).toBe('zenpayroll');
    expect(body.title).toBe('Refactor the widget');
    expect(body.authorLogin).toBe('Connor');
    expect(body.headSha).toBe('abc1234567890');
    expect(body.baseRefName).toBe('main');
    expect(body.headRefName).toBe('feature/foo');
    expect(body.reviewThreads).toEqual([]);
    expect(body.reviews).toEqual([]);
    expect(body.viewerPendingReviewId).toBeNull();
    // ID is stable for the same (repo, branch).
    expect(body.id).toBe('local:zenpayroll:feature/foo');
    await app.close();
  });

  it('GET /api/local/meta returns 400 when path is not a git repo', async () => {
    const nonRepo = await fs.mkdtemp(join(tmpdir(), 'cr-local-not-a-repo-'));
    try {
      const app = await buildServer();
      const res = await app.inject({ url: `/api/local/meta?repo=zenpayroll&path=${encodeURIComponent(nonRepo)}&branch=foo` });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('BAD_PARAMS');
      await app.close();
    } finally {
      await fs.rm(nonRepo, { recursive: true, force: true });
    }
  });

  it('GET /api/local/meta returns 404 when the branch does not exist', async () => {
    const { GitCliError } = await import('../../src/lib/gitExec.js');
    mocked.mockRejectedValueOnce(new GitCliError('GIT_FAILED', 'fatal: bad revision', 'fatal: bad revision'));
    const app = await buildServer();
    const res = await app.inject({ url: `/api/local/meta?repo=zenpayroll&path=${encodeURIComponent(tmp)}&branch=does/not/exist` });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('BRANCH_NOT_FOUND');
    await app.close();
  });

  it('GET /api/local/diff returns the unified diff and caches by headSha', async () => {
    mocked.mockResolvedValueOnce('sha-1\n');                                   // rev-parse
    mocked.mockResolvedValueOnce('diff --git a/file b/file\n@@ -1 +1 @@\n-x\n+y\n'); // diff
    const app = await buildServer();
    const r1 = await app.inject({ url: `/api/local/diff?path=${encodeURIComponent(tmp)}&branch=foo` });
    expect(r1.statusCode).toBe(200);
    expect(r1.headers['content-type']).toContain('text/plain');
    expect(r1.body).toContain('diff --git');

    // Second call with same sha should hit the cache (no extra diff invocation).
    mocked.mockResolvedValueOnce('sha-1\n'); // rev-parse only
    const r2 = await app.inject({ url: `/api/local/diff?path=${encodeURIComponent(tmp)}&branch=foo` });
    expect(r2.body).toContain('diff --git');
    expect(mocked).toHaveBeenCalledTimes(3); // rev-parse + diff + rev-parse(cached)
    await app.close();
  });

  it('GET /api/local/diff returns 400 when branch param is missing', async () => {
    const app = await buildServer();
    const res = await app.inject({ url: `/api/local/diff?path=${encodeURIComponent(tmp)}` });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('GET /api/local/files/content returns file contents at ref', async () => {
    mocked.mockResolvedValueOnce('line1\nline2\nline3\n');
    const app = await buildServer();
    const res = await app.inject({ url: `/api/local/files/content?path=${encodeURIComponent(tmp)}&file=app/widget.rb&ref=main` });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('line1\nline2\nline3\n');
    const callArgs = mocked.mock.calls[0][0] as string[];
    expect(callArgs).toEqual(['show', 'main:app/widget.rb']);
    await app.close();
  });

  it('GET /api/local/files/content returns 404 when the file is missing at that ref', async () => {
    const { GitCliError } = await import('../../src/lib/gitExec.js');
    mocked.mockRejectedValueOnce(new GitCliError('GIT_FAILED', 'fatal: path does not exist', "fatal: path 'app/widget.rb' does not exist in 'main'"));
    const app = await buildServer();
    const res = await app.inject({ url: `/api/local/files/content?path=${encodeURIComponent(tmp)}&file=app/widget.rb&ref=main` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
