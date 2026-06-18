/**
 * Copy of connor-review/server/src/lib/ghExec.ts — kept intentionally local
 * so this service stays independent of the review app. Same retry policy,
 * same error shape, same expectation that the user has `gh` authenticated
 * on the local machine.
 */
import { execFile } from 'node:child_process';

export type GhErrorCode = 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'GH_API_ERROR' | 'GH_CLI_FAILED';

export class GhCliError extends Error {
  override readonly name = 'GhCliError';
  constructor(
    readonly code: GhErrorCode,
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

const AUTH_PATTERNS = [/gh auth login/i, /not authenticated/i, /no token/i];
const GRAPHQL_PATTERNS = [/graphql error/i, /^\s*\{[\s\S]*"errors"/i];
const RATE_LIMIT_PATTERNS = [
  /secondary rate limit/i,
  /primary rate limit/i,
  /API rate limit exceeded/i,
  /\bHTTP 403\b/,
  /\babuse detection/i,
];

function classify(stderr: string): GhErrorCode {
  if (AUTH_PATTERNS.some((r) => r.test(stderr))) return 'AUTH_REQUIRED';
  if (RATE_LIMIT_PATTERNS.some((r) => r.test(stderr))) return 'RATE_LIMITED';
  if (GRAPHQL_PATTERNS.some((r) => r.test(stderr))) return 'GH_API_ERROR';
  return 'GH_CLI_FAILED';
}

export interface GhExecOptions {
  input?: string;
}

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 400;
const TRANSIENT_PATTERNS = [
  /\bHTTP 5\d\d\b/i,
  /HTTP\/2 stream\b/i,
  /stream error/i,
  /connection reset/i,
  /ECONNRESET|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED/,
  /TLS connection/i,
  /timed? out/i,
  /timeout exceeded/i,
];

function isTransient(stderr: string): boolean {
  return TRANSIENT_PATTERNS.some((re) => re.test(stderr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function execOnce(args: string[], opts: GhExecOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile('gh', args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const code = classify(stderr || (err as Error).message);
        reject(new GhCliError(code, `gh ${args.join(' ')} failed: ${stderr.trim()}`, stderr));
        return;
      }
      resolve(stdout);
    });
    if (opts.input != null) {
      child.stdin?.end(opts.input);
    }
  });
}

export async function ghExec(args: string[], opts: GhExecOptions = {}): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await execOnce(args, opts);
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof GhCliError
        && (err.code === 'GH_CLI_FAILED' || err.code === 'GH_API_ERROR')
        && isTransient(err.stderr);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      const jittered = delay * (0.8 + Math.random() * 0.4);
      await sleep(jittered);
    }
  }
  throw lastErr;
}
