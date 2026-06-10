import { execFile } from 'node:child_process';

export type ClaudeErrorCode = 'CLAUDE_NOT_INSTALLED' | 'TIMEOUT' | 'CLAUDE_FAILED';

export class ClaudeCliError extends Error {
  override readonly name = 'ClaudeCliError';
  constructor(
    readonly code: ClaudeErrorCode,
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export interface ClaudeExecOptions {
  /** Hard timeout in ms; default 60_000. Claude responses for code review are
   * typically 5-30s; allow headroom for large diffs. */
  timeoutMs?: number;
}

/** Shells out to the user's local `claude` CLI in non-interactive mode and
 * returns stdout. The prompt is written via stdin (NOT argv) so we don't trip
 * argv-length limits with large diffs.
 *
 * No retries — Claude CLI failures are usually terminal (not installed, prompt
 * rejected, model overloaded). Surfacing the error verbatim is more useful
 * than burning a second attempt.
 */
export function claudeExec(prompt: string, opts: ClaudeExecOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return new Promise((resolve, reject) => {
    const child = execFile('claude', ['-p'], { maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const stderrStr = stderr.toString();
        const errno = (err as NodeJS.ErrnoException).code;
        if (errno === 'ENOENT') {
          reject(new ClaudeCliError('CLAUDE_NOT_INSTALLED', 'claude CLI not found (install Claude Code: https://claude.com/claude-code)', stderrStr));
          return;
        }
        // Node sets killed=true + signal when the timeout fires.
        if ((err as NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals }).killed) {
          reject(new ClaudeCliError('TIMEOUT', `claude -p timed out after ${timeoutMs}ms`, stderrStr));
          return;
        }
        reject(new ClaudeCliError('CLAUDE_FAILED', `claude -p failed: ${stderrStr.trim() || (err as Error).message}`, stderrStr));
        return;
      }
      resolve(stdout.toString());
    });
    child.stdin?.end(prompt);
  });
}
