import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/index.js';
import { ghExec } from '../../src/lib/ghExec.js';
import { gitExec, GitCliError } from '../../src/lib/gitExec.js';
import { claudeExec, ClaudeCliError } from '../../src/lib/claudeExec.js';

const mockedGh = ghExec as unknown as ReturnType<typeof vi.fn>;
const mockedGit = gitExec as unknown as ReturnType<typeof vi.fn>;
const mockedClaude = claudeExec as unknown as ReturnType<typeof vi.fn>;

const META_RESPONSE = JSON.stringify({
  data: {
    repository: {
      pullRequest: {
        id: 'PR_abc',
        number: 1,
        title: 'Resolve me',
        author: { login: 'cdudas17' },
        state: 'OPEN',
        merged: false,
        isDraft: false,
        mergeable: 'CONFLICTING',
        reviewDecision: 'REVIEW_REQUIRED',
        baseRefName: 'main',
        headRefName: 'feature',
        headRefOid: 'sha-feature',
        url: 'https://github.com/Gusto/zenpayroll/pull/1',
        viewerLatestReview: null,
        commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] },
        reviewThreads: { nodes: [] },
      },
    },
  },
});

/** Create a fake repoPath that passes the `.git` existsSync gate. */
function makeFakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'connor-review-resolve-test-'));
  mkdirSync(join(root, '.git'));
  return root;
}

/** Common gitExec dispatcher — pass cases for each subcommand. The test
 * supplies the expected post-Claude state via `conflictFiles` (what
 * `diff --name-only --diff-filter=U` will return) and `status` (what
 * `status --porcelain -z` will return). Override per-test as needed. */
function makeGitDispatch({
  worktreeDirs,
  conflictFiles,
  status,
  parentsLine,
  diffTree,
  pushFails,
  mergeFails,
}: {
  worktreeDirs: string[]; // mutated: route pushes the worktree path into this array
  conflictFiles: string[];
  status: string; // NUL-separated `git status --porcelain -z` output
  parentsLine?: string; // override `rev-list --parents -n 1 HEAD` output
  diffTree?: string; // override `diff-tree --name-only` output (defaults to conflictFiles joined)
  pushFails?: boolean;
  mergeFails?: 'conflict' | 'hard' | false;
}) {
  return async (args: string[], opts: { cwd?: string }) => {
    const cmd = args[0];
    if (cmd === 'fetch') return '';
    if (cmd === 'worktree' && args[1] === 'add') {
      // The worktree path is the 5th arg in our exact invocation: ['worktree','add','-B', headRef, path, remote]
      const path = args[4];
      worktreeDirs.push(path);
      mkdirSync(path, { recursive: true });
      return '';
    }
    if (cmd === 'worktree' && args[1] === 'remove') return '';
    if (cmd === 'rev-parse' && args[1] === 'HEAD') return 'sha-pre-merge\n';
    if (cmd === 'merge' && args.includes('--no-edit')) {
      if (mergeFails === 'hard') throw new GitCliError('GIT_FAILED', 'fatal: base ref missing', 'stderr');
      if (mergeFails === 'conflict' || mergeFails === undefined || mergeFails === false) {
        // Default: merge fails with conflicts (the route catches the throw and
        // moves on to inspect the conflict file set).
        if (mergeFails === false) return '';
        throw new GitCliError('GIT_FAILED', 'merge conflict', 'CONFLICT (content): file');
      }
      return '';
    }
    if (cmd === 'diff' && args.includes('--name-only') && args.includes('--diff-filter=U')) {
      return conflictFiles.join('\n');
    }
    if (cmd === 'status' && args.includes('--porcelain')) {
      return status;
    }
    if (cmd === 'add') return '';
    if (cmd === 'commit') return '[feature abc1234] Resolve merge conflicts with main\n';
    if (cmd === 'rev-list' && args.includes('--parents')) {
      return parentsLine ?? 'sha-merge sha-pre-merge sha-main\n';
    }
    if (cmd === 'diff-tree' && args.includes('--name-only')) {
      return diffTree ?? conflictFiles.join('\n');
    }
    if (cmd === 'push') {
      if (pushFails) throw new GitCliError('GIT_FAILED', 'push rejected', 'rejected by remote');
      return '';
    }
    if (cmd === 'branch' && args[1] === '-D') return '';
    return '';
  };
}

describe('POST /api/pulls/:o/:r/:n/resolve-conflicts', () => {
  let createdRepo: string | null = null;
  const allWorktrees: string[] = [];

  beforeEach(() => {
    mockedGh.mockReset();
    mockedGit.mockReset();
    mockedClaude.mockReset();
    createdRepo = null;
  });

  afterEach(() => {
    if (createdRepo) {
      try { rmSync(createdRepo, { recursive: true, force: true }); } catch { /* ignore */ }
      createdRepo = null;
    }
    // Cleanup any worktree dirs the mocks created.
    for (const wt of allWorktrees) try { rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
    allWorktrees.length = 0;
  });

  it('returns 400 for a missing/invalid repoPath', async () => {
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/resolve-conflicts',
      payload: { repoPath: '/does/not/exist' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_REPO_PATH');
    await app.close();
  });

  it('happy path: Claude resolves cleanly → 200 with commitSha; push fired', async () => {
    createdRepo = makeFakeRepo();
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    mockedGit.mockImplementation(makeGitDispatch({
      worktreeDirs: allWorktrees,
      conflictFiles: ['app/foo.rb', 'app/bar.ts'],
      // status -z output: each record NUL-separated; "M  path".
      status: 'M  app/foo.rb\0M  app/bar.ts\0',
    }));
    // Claude writes "resolved" content (no markers) into both files.
    mockedClaude.mockImplementation(async (_prompt: string, opts: { cwd: string }) => {
      mkdirSync(join(opts.cwd, 'app'), { recursive: true });
      writeFileSync(join(opts.cwd, 'app/foo.rb'), 'resolved foo\n');
      writeFileSync(join(opts.cwd, 'app/bar.ts'), 'resolved bar\n');
      return 'done\n';
    });

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/resolve-conflicts',
      payload: { repoPath: createdRepo },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(res.json().commitSha).toBe('sha-merge');

    // Push was actually called.
    const pushCall = mockedGit.mock.calls.find(([a]) => Array.isArray(a) && a[0] === 'push');
    expect(pushCall).toBeDefined();

    // Claude received the right tool constraints + acceptEdits.
    const claudeOpts = mockedClaude.mock.calls[0][1] as { allowedTools?: string[]; permissionMode?: string };
    expect(claudeOpts.allowedTools).toEqual(['Read', 'Edit']);
    expect(claudeOpts.permissionMode).toBe('acceptEdits');
    await app.close();
  });

  it('LEFTOVER_MARKERS: Claude leaves a conflict marker → 409, no push', async () => {
    createdRepo = makeFakeRepo();
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    mockedGit.mockImplementation(makeGitDispatch({
      worktreeDirs: allWorktrees,
      conflictFiles: ['app/foo.rb'],
      status: 'M  app/foo.rb\0',
    }));
    mockedClaude.mockImplementation(async (_prompt: string, opts: { cwd: string }) => {
      mkdirSync(join(opts.cwd, 'app'), { recursive: true });
      writeFileSync(join(opts.cwd, 'app/foo.rb'), 'before\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> main\nafter\n');
      return 'done\n';
    });

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/resolve-conflicts',
      payload: { repoPath: createdRepo },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('LEFTOVER_MARKERS');
    expect(res.json().files).toEqual(['app/foo.rb']);

    // No push happened.
    const pushCall = mockedGit.mock.calls.find(([a]) => Array.isArray(a) && a[0] === 'push');
    expect(pushCall).toBeUndefined();
    await app.close();
  });

  it('OVERCOMMIT_DETECTED via status: Claude touches a file outside the conflict set → 409, no commit', async () => {
    createdRepo = makeFakeRepo();
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    mockedGit.mockImplementation(makeGitDispatch({
      worktreeDirs: allWorktrees,
      conflictFiles: ['app/foo.rb'],
      // Status shows an EXTRA file modified beyond the conflict set.
      status: 'M  app/foo.rb\0M  README.md\0',
    }));
    mockedClaude.mockImplementation(async (_prompt: string, opts: { cwd: string }) => {
      mkdirSync(join(opts.cwd, 'app'), { recursive: true });
      writeFileSync(join(opts.cwd, 'app/foo.rb'), 'resolved\n');
      return 'done\n';
    });

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/resolve-conflicts',
      payload: { repoPath: createdRepo },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OVERCOMMIT_DETECTED');
    expect(res.json().files).toContain('README.md');

    // No commit, no push.
    const commitCall = mockedGit.mock.calls.find(([a]) => Array.isArray(a) && a[0] === 'commit');
    expect(commitCall).toBeUndefined();
    const pushCall = mockedGit.mock.calls.find(([a]) => Array.isArray(a) && a[0] === 'push');
    expect(pushCall).toBeUndefined();
    await app.close();
  });

  it('OVERCOMMIT_DETECTED via commit shape: rev-list returns wrong parents → 409, no push', async () => {
    createdRepo = makeFakeRepo();
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    mockedGit.mockImplementation(makeGitDispatch({
      worktreeDirs: allWorktrees,
      conflictFiles: ['app/foo.rb'],
      status: 'M  app/foo.rb\0',
      // Three parents = NOT a clean merge commit (octopus or wrong base).
      parentsLine: 'sha-merge sha-pre-merge sha-other sha-third',
    }));
    mockedClaude.mockImplementation(async (_prompt: string, opts: { cwd: string }) => {
      mkdirSync(join(opts.cwd, 'app'), { recursive: true });
      writeFileSync(join(opts.cwd, 'app/foo.rb'), 'resolved\n');
      return 'done\n';
    });

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/resolve-conflicts',
      payload: { repoPath: createdRepo },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('OVERCOMMIT_DETECTED');

    const pushCall = mockedGit.mock.calls.find(([a]) => Array.isArray(a) && a[0] === 'push');
    expect(pushCall).toBeUndefined();
    await app.close();
  });

  it('CLAUDE_NOT_INSTALLED: claudeExec throws → 502 with the install message', async () => {
    createdRepo = makeFakeRepo();
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    mockedGit.mockImplementation(makeGitDispatch({
      worktreeDirs: allWorktrees,
      conflictFiles: ['app/foo.rb'],
      status: '',
    }));
    mockedClaude.mockRejectedValueOnce(new ClaudeCliError('CLAUDE_NOT_INSTALLED', 'claude CLI not found', ''));

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/resolve-conflicts',
      payload: { repoPath: createdRepo },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('CLAUDE_NOT_INSTALLED');
    await app.close();
  });

  it('PUSH_FAILED: push step throws → 502 PUSH_FAILED', async () => {
    createdRepo = makeFakeRepo();
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    mockedGit.mockImplementation(makeGitDispatch({
      worktreeDirs: allWorktrees,
      conflictFiles: ['app/foo.rb'],
      status: 'M  app/foo.rb\0',
      pushFails: true,
    }));
    mockedClaude.mockImplementation(async (_prompt: string, opts: { cwd: string }) => {
      mkdirSync(join(opts.cwd, 'app'), { recursive: true });
      writeFileSync(join(opts.cwd, 'app/foo.rb'), 'resolved\n');
      return 'done\n';
    });

    const app = await buildServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/pulls/Gusto/zenpayroll/1/resolve-conflicts',
      payload: { repoPath: createdRepo },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('PUSH_FAILED');
    await app.close();
  });
});
