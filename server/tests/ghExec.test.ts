import { describe, it, expect, vi } from 'vitest';
import * as childProcess from 'node:child_process';
import { ghExec } from '../src/lib/ghExec.js';

vi.mock('node:child_process', () => {
  const execFile = vi.fn();
  return { execFile };
});

function mockExecFile(stdout: string, stderr = '', code = 0) {
  (childProcess.execFile as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (
      _cmd: string,
      _args: string[],
      _opts: unknown,
      cb: (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => void,
    ) => {
      if (code === 0) {
        cb(null, stdout, stderr);
        return;
      }
      const err = new Error(`exit ${code}`) as Error & {
        stdout?: string;
        stderr?: string;
        exitCode?: number;
      };
      err.exitCode = code;
      err.stdout = stdout;
      err.stderr = stderr;
      cb(err, stdout, stderr);
    },
  );
}

describe('ghExec', () => {
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
