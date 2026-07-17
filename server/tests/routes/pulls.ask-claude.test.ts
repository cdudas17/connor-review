import { describe, it, expect, beforeEach, vi } from 'vitest';

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

vi.mock('../../src/lib/codexExec.js', () => {
  const codexExec = vi.fn();
  class CodexCliError extends Error {
    override readonly name = 'CodexCliError';
    constructor(public code: string, message: string, public stderr: string) {
      super(message);
    }
  }
  return { codexExec, CodexCliError };
});

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/index.js';
import { ghExec } from '../../src/lib/ghExec.js';
import { codexExec, CodexCliError } from '../../src/lib/codexExec.js';

const mockedGh = ghExec as unknown as ReturnType<typeof vi.fn>;
const mockedCodex = codexExec as unknown as ReturnType<typeof vi.fn>;

const PR_GRAPHQL_RESPONSE = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        id: 'PR_abc',
        number: 1,
        title: 'Test PR',
        author: { login: 'newtonry' },
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

const DIFF = 'diff --git a/file.txt b/file.txt\nindex 0..1\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n';

describe('POST /api/pulls/:o/:r/:n/claude/ask', () => {
  beforeEach(() => {
    mockedGh.mockReset();
    mockedCodex.mockReset();
  });

  it('returns 400 when draft is empty', async () => {
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: '   ' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_PARAMS');
    await app.close();
  });

  it('builds a structured prompt with title, author, diff, and draft, and returns the response', async () => {
    // gh calls: meta GraphQL, then `gh pr diff` for the diff.
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedCodex.mockResolvedValueOnce('Looks fine. One concern: ...\n');

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: 'is this safe to merge?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ response: 'Looks fine. One concern: ...', truncatedDiff: false });

    // Inspect the prompt actually sent to codexExec.
    const prompt = mockedCodex.mock.calls[0][0] as string;
    expect(prompt).toContain('"Test PR"');
    expect(prompt).toContain('@newtonry');
    expect(prompt).toContain('Gusto/zenpayroll');
    expect(prompt).toContain('-old');
    expect(prompt).toContain('+new');
    expect(prompt).toContain('> is this safe to merge?');
    // No line range was passed → no per-line block.
    expect(prompt).not.toContain('commenting on');
    // Read-only sandbox — this endpoint reviews, it doesn't write.
    const opts = mockedCodex.mock.calls[0][1] as { sandbox?: string };
    expect(opts?.sandbox).toBe('read-only');
    await app.close();
  });

  it('includes a line range block when the inline composer asks', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedCodex.mockResolvedValueOnce('Thoughts...\n');

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: {
        draft: 'why are we mutating here?',
        lineRange: { path: 'app/widget.rb', endLine: 42, startLine: 38, side: 'RIGHT' },
      },
    });
    expect(res.statusCode).toBe(200);
    const prompt = mockedCodex.mock.calls[0][0] as string;
    expect(prompt).toContain('app/widget.rb');
    expect(prompt).toContain('lines 38–42');
    expect(prompt).toContain('new/added side');
    await app.close();
  });

  it('truncates huge diffs and signals truncatedDiff=true', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce('x'.repeat(200_000)); // > 150k cap
    mockedCodex.mockResolvedValueOnce('ok\n');
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: 'thoughts?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().truncatedDiff).toBe(true);
    const prompt = mockedCodex.mock.calls[0][0] as string;
    expect(prompt).toContain('diff truncated');
    await app.close();
  });

  it('includes the prior conversation in the prompt when one is supplied', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedCodex.mockResolvedValueOnce('continuing...\n');
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: {
        draft: 'follow up question',
        conversation: [
          { role: 'user', body: 'first ask' },
          { role: 'claude', body: 'first reply' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const prompt = mockedCodex.mock.calls[0][0] as string;
    // The history block is present.
    expect(prompt).toContain('Conversation so far');
    expect(prompt).toContain('[User]:\nfirst ask');
    expect(prompt).toContain('[Claude]:\nfirst reply');
    // The latest message is labeled differently when history is present.
    expect(prompt).toContain("User's latest message");
    expect(prompt).toContain('> follow up question');
    expect(prompt).not.toContain("User's draft comment");
    await app.close();
  });

  it('does NOT add a conversation block when none is supplied (first-turn path unchanged)', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedCodex.mockResolvedValueOnce('ok\n');
    const app = await buildServer();
    await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: 'q' },
    });
    const prompt = mockedCodex.mock.calls[0][0] as string;
    expect(prompt).not.toContain('Conversation so far');
    expect(prompt).toContain("User's draft comment");
    await app.close();
  });

  it('passes repoPath as cwd to codexExec when the path is a valid git checkout', async () => {
    // Make a fake repo dir so the validation passes.
    const tmp = await fs.mkdtemp(join(tmpdir(), 'cr-codex-cwd-'));
    try {
      await fs.mkdir(join(tmp, '.git'));
      mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
      mockedGh.mockResolvedValueOnce(DIFF);
      mockedCodex.mockResolvedValueOnce('ok\n');
      const app = await buildServer();
      const res = await app.inject({
        method: 'POST',
        url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
        payload: { draft: 'q', repoPath: tmp },
      });
      expect(res.statusCode).toBe(200);
      const opts = mockedCodex.mock.calls[0][1] as { cwd?: string } | undefined;
      expect(opts?.cwd).toBe(tmp);
      await app.close();
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  it('silently ignores repoPath when the path is not a git checkout (falls back to default cwd)', async () => {
    // Path doesn't exist on disk → validation fails, no cwd passed.
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedCodex.mockResolvedValueOnce('ok\n');
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: 'q', repoPath: '/Users/nobody/no-such-path' },
    });
    expect(res.statusCode).toBe(200);
    const opts = mockedCodex.mock.calls[0][1] as { cwd?: string } | undefined;
    expect(opts?.cwd).toBeUndefined();
    await app.close();
  });

  it('maps CODEX_NOT_INSTALLED to 502', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedCodex.mockRejectedValueOnce(new CodexCliError('CODEX_NOT_INSTALLED', 'codex CLI not found', ''));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: 'hi' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('CODEX_NOT_INSTALLED');
    await app.close();
  });

  it('maps TIMEOUT to 504', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedCodex.mockRejectedValueOnce(new CodexCliError('TIMEOUT', 'codex exec timed out after 300000ms', ''));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: 'hi' },
    });
    expect(res.statusCode).toBe(504);
    expect(res.json().code).toBe('TIMEOUT');
    await app.close();
  });
});
