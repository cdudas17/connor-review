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
import { dirname, join } from 'node:path';
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
 * supplies the conflict set + the `git status --porcelain -z` output. The
 * `worktreeFiles` option lets a test pre-populate the worktree with stub
 * file contents so the route's pre-Claude hash snapshot can read them; by
 * default, every conflict file is created with a marker stub. */
function makeGitDispatch({
  worktreeDirs,
  conflictFiles,
  status,
  worktreeFiles,
  parentsLine,
  pushFails,
  mergeFails,
}: {
  worktreeDirs: string[]; // mutated: route pushes the worktree path into this array
  conflictFiles: string[];
  status: string; // NUL-separated `git status --porcelain -z` output
  /** Map of relative-path → file content. Written into the worktree during
   * `worktree add`. Defaults to one entry per conflict file with marker stub. */
  worktreeFiles?: Record<string, string>;
  parentsLine?: string; // override `rev-list --parents -n 1 HEAD` output
  pushFails?: boolean;
  mergeFails?: 'conflict' | 'hard' | false;
}) {
  const MARKER_STUB = '<<<<<<< HEAD\nstub HEAD\n=======\nstub base\n>>>>>>> base\n';
  return async (args: string[], _opts: { cwd?: string }) => {
    const cmd = args[0];
    if (cmd === 'fetch') return '';
    if (cmd === 'worktree' && args[1] === 'add') {
      // The worktree path is the 5th arg in our exact invocation: ['worktree','add','-B', headRef, path, remote]
      const path = args[4];
      worktreeDirs.push(path);
      mkdirSync(path, { recursive: true });
      // Pre-populate the worktree so the route's hash snapshot has files to
      // read. Default: each conflict file gets a marker stub.
      const files = worktreeFiles ?? Object.fromEntries(conflictFiles.map((f) => [f, MARKER_STUB]));
      for (const [rel, content] of Object.entries(files)) {
        const abs = join(path, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
      return '';
    }
    if (cmd === 'worktree' && args[1] === 'remove') return '';
    if (cmd === 'rev-parse' && args[1] === 'HEAD') return 'sha-pre-merge\n';
    if (cmd === 'merge' && args.includes('--no-commit')) {
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

  it('OVERCOMMIT_DETECTED via content hash: Claude modifies a non-conflict file → 409, no push', async () => {
    createdRepo = makeFakeRepo();
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    // README.md is an auto-merged file (in status but NOT a conflict file).
    // Pre-Claude snapshot hashes its known auto-merged content. Claude then
    // touches BOTH the conflict file (allowed) AND README.md (over-commit).
    mockedGit.mockImplementation(makeGitDispatch({
      worktreeDirs: allWorktrees,
      conflictFiles: ['app/foo.rb'],
      status: 'M  app/foo.rb\0M  README.md\0',
      worktreeFiles: {
        'app/foo.rb': '<<<<<<< HEAD\nstub\n=======\nbase\n>>>>>>> base\n',
        'README.md': 'auto-merged content from git\n',
      },
    }));
    mockedClaude.mockImplementation(async (_prompt: string, opts: { cwd: string }) => {
      mkdirSync(join(opts.cwd, 'app'), { recursive: true });
      writeFileSync(join(opts.cwd, 'app/foo.rb'), 'resolved\n');
      // ⚠️ Claude touches a non-conflict file — over-commit.
      writeFileSync(join(opts.cwd, 'README.md'), 'overwritten by Claude\n');
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

    // No commit, no push — over-commit caught before staging.
    const commitCall = mockedGit.mock.calls.find(([a]) => Array.isArray(a) && a[0] === 'commit');
    expect(commitCall).toBeUndefined();
    const pushCall = mockedGit.mock.calls.find(([a]) => Array.isArray(a) && a[0] === 'push');
    expect(pushCall).toBeUndefined();
    await app.close();
  });

  it('does NOT false-positive on stale branches with thousands of auto-merged files', async () => {
    createdRepo = makeFakeRepo();
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    // Stale-branch repro: status lists thousands of auto-merged paths in
    // addition to the conflict files. The content-hash check should ignore
    // them since their hashes don't change between pre- and post-Claude.
    const conflictFiles = ['app/foo.rb'];
    const lotsOfAutoMerged = Array.from({ length: 3826 }, (_, i) => `unrelated/${i}.ts`);
    const status = [...conflictFiles, ...lotsOfAutoMerged].map((p) => `M  ${p}`).join('\0') + '\0';
    // Pre-populate each auto-merged file with stable content so its hash is
    // identical pre- and post-Claude.
    const worktreeFiles: Record<string, string> = {
      'app/foo.rb': '<<<<<<< HEAD\nstub\n=======\nbase\n>>>>>>> base\n',
    };
    for (const p of lotsOfAutoMerged) worktreeFiles[p] = `auto-merged ${p}\n`;
    mockedGit.mockImplementation(makeGitDispatch({
      worktreeDirs: allWorktrees,
      conflictFiles,
      status,
      worktreeFiles,
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
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    await app.close();
  });

  it('does NOT false-positive when git used a custom merge driver (--cc would have flagged it)', async () => {
    // Concrete repro for the user's PR 348501 symptom: Gemfile.lock was
    // auto-resolved by Bundler's merge driver, so it ends up in the merge
    // commit's combined diff (--cc) even though Claude never touched it.
    // The content-hash check should NOT flag it because the pre-Claude
    // snapshot already captured the driver's output.
    createdRepo = makeFakeRepo();
    mockedGh.mockResolvedValueOnce(META_RESPONSE);
    mockedGit.mockImplementation(makeGitDispatch({
      worktreeDirs: allWorktrees,
      conflictFiles: ['app/foo.rb'],
      status: 'M  app/foo.rb\0M  Gemfile.lock\0M  app/bar/renamed.ts\0',
      worktreeFiles: {
        'app/foo.rb': '<<<<<<< HEAD\nstub\n=======\nbase\n>>>>>>> base\n',
        'Gemfile.lock': 'BUNDLED WITH\n  2.5.0\n',
        'app/bar/renamed.ts': 'export const foo = 1;\n',
      },
    }));
    mockedClaude.mockImplementation(async (_prompt: string, opts: { cwd: string }) => {
      mkdirSync(join(opts.cwd, 'app'), { recursive: true });
      writeFileSync(join(opts.cwd, 'app/foo.rb'), 'resolved\n');
      // Claude does NOT touch Gemfile.lock or the renamed file.
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
