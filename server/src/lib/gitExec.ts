import { execFile } from 'node:child_process';

export type GitErrorCode = 'GIT_NOT_INSTALLED' | 'GIT_FAILED';

export class GitCliError extends Error {
  override readonly name = 'GitCliError';
  constructor(
    readonly code: GitErrorCode,
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export interface GitExecOptions {
  /** Working directory for the git command. Required — every git invocation is scoped to a checkout. */
  cwd: string;
  /** If set, this string is written to git's stdin then stdin is closed. */
  input?: string;
}

// Retries for transient errors (e.g. background git index lock contention with another tool).
// Most git CLI failures are deterministic config/path issues, so retries are short.
const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 200;
const TRANSIENT_PATTERNS = [
  /index\.lock/i,             // another git process is running
  /\bbroken pipe\b/i,
];

function isTransient(stderr: string): boolean {
  return TRANSIENT_PATTERNS.some((re) => re.test(stderr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execOnce(args: string[], opts: GitExecOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd: opts.cwd, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const stderrStr = stderr.toString();
        const msg = (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'git not installed (or not on PATH)'
          : `git ${args.join(' ')} failed: ${stderrStr.trim()}`;
        const code: GitErrorCode = (err as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'GIT_NOT_INSTALLED'
          : 'GIT_FAILED';
        reject(new GitCliError(code, msg, stderrStr));
        return;
      }
      resolve(stdout.toString());
    });
    if (opts.input != null) {
      child.stdin?.end(opts.input);
    }
  });
}

export async function gitExec(args: string[], opts: GitExecOptions): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await execOnce(args, opts);
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof GitCliError && err.code === 'GIT_FAILED' && isTransient(err.stderr);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
    }
  }
  throw lastErr;
}
