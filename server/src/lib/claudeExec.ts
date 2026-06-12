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
  /** Hard timeout in ms; default 300_000 (5 min). Claude responses for code
   * review are typically 5-30s but can run a few minutes on very large diffs
   * or when the model needs to think through complex changes — better to let
   * those run than to hard-cut early and force a retry. */
  timeoutMs?: number;
  /** Working directory for `claude -p`. Lets Claude grep the actual repo
   * being reviewed (e.g. `~/workspace/zenpayroll`) instead of the connor-review
   * server dir. Caller is responsible for validating the path. */
  cwd?: string;
  /** Restrict Claude to a specific set of tools (e.g. ['Read', 'Edit']) via
   * the CLI's `--allowedTools` flag. Used by the conflict-resolution route to
   * make sure Claude can't run arbitrary shell / git commands. Empty/undefined
   * leaves the default allowlist (everything) in place. */
  allowedTools?: string[];
  /** Pass `--permission-mode <mode>` so the CLI applies edits non-interactively.
   * Set to 'acceptEdits' for batch/headless flows where blocking on per-edit
   * prompts would deadlock. */
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
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
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const args = ['-p'];
  if (opts.allowedTools && opts.allowedTools.length > 0) {
    args.push('--allowedTools', opts.allowedTools.join(','));
  }
  if (opts.permissionMode) {
    args.push('--permission-mode', opts.permissionMode);
  }
  return new Promise((resolve, reject) => {
    const child = execFile('claude', args, { maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs, cwd: opts.cwd }, (err, stdout, stderr) => {
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
