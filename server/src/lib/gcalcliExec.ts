/**
 * Shell-out wrapper for the user's local `gcalcli` CLI. Same shape as
 * `ghExec` / `claudeExec` so the Calendar tab follows the rest of the
 * app's pattern: no SDK, no token management — just shell out to a
 * locally-authenticated CLI.
 *
 * Setup (one-time, on the user's machine):
 *   brew install gcalcli  (or: pipx install gcalcli)
 *   gcalcli init           (opens a browser; stores token at ~/.gcalcli_oauth)
 *
 * gcalcli ships with its own pre-registered OAuth client, so the user
 * doesn't have to create a Google Cloud project / OAuth client / etc.
 */
import { execFile } from 'node:child_process';

export type GcalcliErrorCode = 'GCALCLI_NOT_INSTALLED' | 'GCALCLI_NOT_AUTHENTICATED' | 'GCALCLI_FAILED';

export class GcalcliError extends Error {
  override readonly name = 'GcalcliError';
  constructor(
    readonly code: GcalcliErrorCode,
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

const NOT_AUTH_PATTERNS = [
  /\bno credentials\b/i,
  /\brun.*gcalcli init\b/i,
  /\bnot authenticated\b/i,
  /\boauth2.*not found\b/i,
  /\bunauthorized_client\b/i,
  /\binvalid_grant\b/i,
  /\bToken has been (expired|revoked)\b/i,
];

function classify(stderr: string, errno: string | undefined): GcalcliErrorCode {
  if (errno === 'ENOENT') return 'GCALCLI_NOT_INSTALLED';
  if (NOT_AUTH_PATTERNS.some((re) => re.test(stderr))) return 'GCALCLI_NOT_AUTHENTICATED';
  return 'GCALCLI_FAILED';
}

export interface GcalcliExecOptions {
  /** Hard timeout in ms; default 20s. Calendar queries should be quick. */
  timeoutMs?: number;
}

export function gcalcliExec(args: string[], opts: GcalcliExecOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  return new Promise((resolve, reject) => {
    execFile(
      'gcalcli',
      args,
      { maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) {
          const stderrStr = stderr.toString();
          const errno = (err as NodeJS.ErrnoException).code as string | undefined;
          const code = classify(stderrStr, errno);
          reject(new GcalcliError(code, `gcalcli ${args.join(' ')} failed: ${stderrStr.trim() || (err as Error).message}`, stderrStr));
          return;
        }
        resolve(stdout.toString());
      },
    );
  });
}
