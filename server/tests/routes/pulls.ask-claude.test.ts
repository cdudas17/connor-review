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

vi.mock('../../src/lib/claudeExec.js', () => {
  const claudeExec = vi.fn();
  class ClaudeCliError extends Error {
    override readonly name = 'ClaudeCliError';
    constructor(public code: string, message: string, public stderr: string) {
      super(message);
    }
  }
  return { claudeExec, ClaudeCliError };
});

import { buildServer } from '../../src/index.js';
import { ghExec } from '../../src/lib/ghExec.js';
import { claudeExec, ClaudeCliError } from '../../src/lib/claudeExec.js';

const mockedGh = ghExec as unknown as ReturnType<typeof vi.fn>;
const mockedClaude = claudeExec as unknown as ReturnType<typeof vi.fn>;

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
    mockedClaude.mockReset();
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
    mockedClaude.mockResolvedValueOnce('Looks fine. One concern: ...\n');

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: 'is this safe to merge?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ response: 'Looks fine. One concern: ...', truncatedDiff: false });

    // Inspect the prompt actually sent to claudeExec.
    const prompt = mockedClaude.mock.calls[0][0] as string;
    expect(prompt).toContain('"Test PR"');
    expect(prompt).toContain('@newtonry');
    expect(prompt).toContain('Gusto/zenpayroll');
    expect(prompt).toContain('-old');
    expect(prompt).toContain('+new');
    expect(prompt).toContain('> is this safe to merge?');
    // No line range was passed → no per-line block.
    expect(prompt).not.toContain('commenting on');
    await app.close();
  });

  it('includes a line range block when the inline composer asks', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedClaude.mockResolvedValueOnce('Thoughts...\n');

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
    const prompt = mockedClaude.mock.calls[0][0] as string;
    expect(prompt).toContain('app/widget.rb');
    expect(prompt).toContain('lines 38–42');
    expect(prompt).toContain('new/added side');
    await app.close();
  });

  it('truncates huge diffs and signals truncatedDiff=true', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce('x'.repeat(200_000)); // > 150k cap
    mockedClaude.mockResolvedValueOnce('ok\n');
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: 'thoughts?' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().truncatedDiff).toBe(true);
    const prompt = mockedClaude.mock.calls[0][0] as string;
    expect(prompt).toContain('diff truncated');
    await app.close();
  });

  it('maps CLAUDE_NOT_INSTALLED to 502', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedClaude.mockRejectedValueOnce(new ClaudeCliError('CLAUDE_NOT_INSTALLED', 'claude CLI not found', ''));
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/claude/ask',
      payload: { draft: 'hi' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('CLAUDE_NOT_INSTALLED');
    await app.close();
  });

  it('maps TIMEOUT to 504', async () => {
    mockedGh.mockResolvedValueOnce(PR_GRAPHQL_RESPONSE);
    mockedGh.mockResolvedValueOnce(DIFF);
    mockedClaude.mockRejectedValueOnce(new ClaudeCliError('TIMEOUT', 'claude -p timed out after 300000ms', ''));
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
