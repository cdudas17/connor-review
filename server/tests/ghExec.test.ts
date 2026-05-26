import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as childProcess from 'node:child_process';
import { ghExec } from '../src/lib/ghExec.js';

vi.mock('node:child_process', () => {
  const execFile = vi.fn();
  return { execFile };
});

type ExecFileCb = (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void;

interface Response { stdout?: string; stderr?: string; code?: number; }

/** Queue a sequence of responses; each invocation of execFile consumes one. */
function queueResponses(...responses: Response[]) {
  const queue = [...responses];
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: ExecFileCb) => {
      const r = queue.shift() ?? { stdout: '', stderr: '', code: 0 };
      if ((r.code ?? 0) === 0) {
        cb(null, r.stdout ?? '', r.stderr ?? '');
        return;
      }
      const err = new Error(`exit ${r.code}`) as Error & { stdout?: string; stderr?: string; exitCode?: number };
      err.exitCode = r.code;
      err.stdout = r.stdout;
      err.stderr = r.stderr;
      cb(err, r.stdout ?? '', r.stderr ?? '');
    },
  );
}

function mockExecFile(stdout: string, stderr = '', code = 0) {
  queueResponses({ stdout, stderr, code });
}

beforeEach(() => {
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockReset();
});

describe('ghExec — error classification', () => {
  it('returns stdout on success', async () => {
    mockExecFile('hello\n');
    const out = await ghExec(['api', 'user']);
    expect(out).toBe('hello\n');
  });

  it('throws GhCliError tagged AUTH_REQUIRED when stderr mentions gh auth login', async () => {
    mockExecFile('', 'error: gh auth login required', 1);
    await expect(ghExec(['api', 'user'])).rejects.toMatchObject({
      name: 'GhCliError',
      code: 'AUTH_REQUIRED',
    });
  });

  it('throws GhCliError tagged GH_API_ERROR when stderr is a GraphQL error', async () => {
    mockExecFile('', 'GraphQL error: Could not resolve to a PullRequest', 1);
    await expect(ghExec(['api', 'graphql', '-f', 'query=x'])).rejects.toMatchObject({
      name: 'GhCliError',
      code: 'GH_API_ERROR',
    });
  });

  it('throws GhCliError tagged GH_CLI_FAILED for any other nonzero exit', async () => {
    mockExecFile('', 'some other failure', 1);
    await expect(ghExec(['pr', 'diff', '1'])).rejects.toMatchObject({
      name: 'GhCliError',
      code: 'GH_CLI_FAILED',
    });
  });
});

describe('ghExec — retry behavior', () => {
  it('retries a transient HTTP 502 and returns the success on the second attempt', async () => {
    queueResponses(
      { stdout: '', stderr: 'gh: HTTP 502\n', code: 1 },
      { stdout: '{"ok":true}', stderr: '', code: 0 },
    );
    const out = await ghExec(['api', 'graphql']);
    expect(out).toBe('{"ok":true}');
    expect(childProcess.execFile).toHaveBeenCalledTimes(2);
  });

  it('retries on HTTP/2 stream cancel', async () => {
    queueResponses(
      { stdout: '', stderr: 'stream error: stream ID 1; CANCEL; received from peer\n', code: 1 },
      { stdout: 'ok', stderr: '', code: 0 },
    );
    const out = await ghExec(['api', 'graphql']);
    expect(out).toBe('ok');
    expect(childProcess.execFile).toHaveBeenCalledTimes(2);
  });

  it('retries on connection reset', async () => {
    queueResponses(
      { stdout: '', stderr: 'ECONNRESET reading response\n', code: 1 },
      { stdout: 'ok', stderr: '', code: 0 },
    );
    const out = await ghExec(['api', 'user']);
    expect(out).toBe('ok');
    expect(childProcess.execFile).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry an AUTH_REQUIRED error', async () => {
    queueResponses({ stdout: '', stderr: 'gh auth login required', code: 1 });
    await expect(ghExec(['api', 'user'])).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a non-transient GraphQL semantic error', async () => {
    queueResponses({ stdout: '', stderr: 'GraphQL error: Could not resolve to a PullRequest', code: 1 });
    await expect(ghExec(['api', 'graphql'])).rejects.toMatchObject({ code: 'GH_API_ERROR' });
    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
  });

  it('does not retry generic CLI failures (only transient ones)', async () => {
    queueResponses({ stdout: '', stderr: 'usage: gh <command> ...\n', code: 2 });
    await expect(ghExec(['unknown'])).rejects.toMatchObject({ code: 'GH_CLI_FAILED' });
    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
  });
});
