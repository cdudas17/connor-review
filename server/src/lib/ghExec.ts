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
  /\bHTTP 403\b/,            // gh reports rate-limited responses as HTTP 403
  /\babuse detection/i,       // older "abuse rate limit" wording
];

function classify(stderr: string): GhErrorCode {
  if (AUTH_PATTERNS.some((r) => r.test(stderr))) return 'AUTH_REQUIRED';
  if (RATE_LIMIT_PATTERNS.some((r) => r.test(stderr))) return 'RATE_LIMITED';
  if (GRAPHQL_PATTERNS.some((r) => r.test(stderr))) return 'GH_API_ERROR';
  return 'GH_CLI_FAILED';
}

function summarizeArgs(args: string[]): string {
  // Avoid dumping multi-line GraphQL query bodies into error messages — just keep the gh subcommand.
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if ((a === '-f' || a === '-F') && args[i + 1]?.startsWith('query=')) {
      out.push(a, 'query=<...>');
      i++;
      continue;
    }
    out.push(a);
  }
  return out.join(' ');
}

export interface GhExecOptions {
  /** If set, the string is written to gh's stdin (and stdin is closed). */
  input?: string;
}

// Retry settings for transient upstream errors. Backoff is exponential with jitter.
// 6 attempts ≈ 400/800/1600/3200/6400 ms = ~12s worst-case retry window, which is
// the right tradeoff for paginated requests (one transient failure mid-pagination
// otherwise tanks the whole multi-page fetch).
const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 400;
const TRANSIENT_PATTERNS = [
  /\bHTTP 5\d\d\b/i,           // 500, 502, 503, 504
  /HTTP\/2 stream\b/i,         // "HTTP/2 stream 1 was not closed cleanly"
  /stream error/i,             // "stream error: stream ID 1; CANCEL; received from peer"
  /connection reset/i,
  /ECONNRESET|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED/,
  /TLS connection/i,
  /timed? out/i,
  /timeout exceeded/i,
  /unexpected end of JSON input/i,   // gh got a truncated response mid-stream
  /unexpected EOF/i,                  // sometimes printed instead
  /EOF\b/,                            // catch-all for shorter "EOF" messages
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
        reject(new GhCliError(code, `gh ${summarizeArgs(args)} failed: ${stderr.trim()}`, stderr));
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
      // Only retry GH_CLI_FAILED with transient upstream errors. Auth and GraphQL semantic
      // errors should NOT be retried — they'll always fail.
      const retryable = err instanceof GhCliError
        && (err.code === 'GH_CLI_FAILED' || err.code === 'GH_API_ERROR')
        && isTransient(err.stderr);
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      // Exponential backoff with +/- 20% jitter: 400, 800, 1600 ms.
      const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
      const jittered = delay * (0.8 + Math.random() * 0.4);
      await sleep(jittered);
    }
  }
  throw lastErr;
}
