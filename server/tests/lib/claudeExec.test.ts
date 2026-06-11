import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as childProcess from 'node:child_process';
import { claudeExec, ClaudeCliError } from '../../src/lib/claudeExec.js';

vi.mock('node:child_process', () => {
  const execFile = vi.fn();
  return { execFile };
});

type ExecFileCb = (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void;

interface MockResult {
  stdout?: string;
  stderr?: string;
  errno?: 'ENOENT' | null;
  killed?: boolean; // simulates a timeout
}

/** Build a fake ChildProcess with a stdin that records what we wrote. */
function mockChild(captureStdin?: { value: string }) {
  return {
    stdin: {
      end(buf: string) {
        if (captureStdin) captureStdin.value = buf;
      },
    },
  };
}

function setExecFile(result: MockResult, captureStdin?: { value: string }) {
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
      // Fire the callback async so the synchronous part of claudeExec (stdin.end) runs first.
      setTimeout(() => {
        if (result.errno === 'ENOENT') {
          const err = new Error('not found') as NodeJS.ErrnoException & { killed?: boolean };
          err.code = 'ENOENT';
          cb(err, '', '');
          return;
        }
        if (result.killed) {
          const err = new Error('killed') as NodeJS.ErrnoException & { killed?: boolean };
          err.killed = true;
          cb(err, '', result.stderr ?? '');
          return;
        }
        cb(null, result.stdout ?? '', result.stderr ?? '');
      }, 0);
      return mockChild(captureStdin);
    },
  );
}

beforeEach(() => {
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('claudeExec', () => {
  it('writes the prompt to stdin and returns stdout', async () => {
    const captured = { value: '' };
    setExecFile({ stdout: 'hello from claude\n' }, captured);
    const out = await claudeExec('what do you think of this diff?');
    expect(out).toBe('hello from claude\n');
    expect(captured.value).toBe('what do you think of this diff?');
    // Confirms we invoked `claude -p` (not interactive mode).
    const call = (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('claude');
    expect(call[1]).toEqual(['-p']);
  });

  it('passes the cwd option through to execFile', async () => {
    setExecFile({ stdout: 'ok\n' });
    await claudeExec('hi', { cwd: '/Users/me/zenpayroll' });
    const call = (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2]).toMatchObject({ cwd: '/Users/me/zenpayroll' });
  });

  it('throws CLAUDE_NOT_INSTALLED when the CLI is missing', async () => {
    setExecFile({ errno: 'ENOENT' });
    await expect(claudeExec('hi')).rejects.toMatchObject({
      name: 'ClaudeCliError',
      code: 'CLAUDE_NOT_INSTALLED',
    });
  });

  it('throws TIMEOUT when the process is killed (Node sets killed=true on timeout)', async () => {
    setExecFile({ killed: true, stderr: 'sig kill' });
    await expect(claudeExec('hi', { timeoutMs: 50 })).rejects.toMatchObject({
      name: 'ClaudeCliError',
      code: 'TIMEOUT',
    });
  });

  it('throws CLAUDE_FAILED with stderr for arbitrary non-zero exits', async () => {
    (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
        setTimeout(() => {
          const err = new Error('exit 2') as NodeJS.ErrnoException;
          cb(err, '', 'prompt rejected: too long');
        }, 0);
        return { stdin: { end() { /* no-op */ } } };
      },
    );
    const e = await claudeExec('hi').then(() => null, (x) => x as ClaudeCliError);
    expect(e).not.toBeNull();
    expect(e!.code).toBe('CLAUDE_FAILED');
    expect(e!.message).toContain('prompt rejected');
  });
});
