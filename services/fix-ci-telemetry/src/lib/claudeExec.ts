/**
 * Copy of connor-review/server/src/lib/claudeExec.ts — kept intentionally
 * local so this service stays independent of the review app. The
 * propose-prompt worker uses it to ask Claude for a revised Fix CI prompt
 * given a cluster of failed runs.
 */
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
  timeoutMs?: number;
  cwd?: string;
  allowedTools?: string[];
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'bypassPermissions';
}

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
    const child = execFile(
      'claude',
      args,
      { maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs, cwd: opts.cwd },
      (err, stdout, stderr) => {
        if (err) {
          const stderrStr = stderr.toString();
          const errno = (err as NodeJS.ErrnoException).code;
          if (errno === 'ENOENT') {
            reject(new ClaudeCliError('CLAUDE_NOT_INSTALLED', 'claude CLI not found (install Claude Code: https://claude.com/claude-code)', stderrStr));
            return;
          }
          if ((err as NodeJS.ErrnoException & { killed?: boolean; signal?: NodeJS.Signals }).killed) {
            reject(new ClaudeCliError('TIMEOUT', `claude -p timed out after ${timeoutMs}ms`, stderrStr));
            return;
          }
          reject(new ClaudeCliError('CLAUDE_FAILED', `claude -p failed: ${stderrStr.trim() || (err as Error).message}`, stderrStr));
          return;
        }
        resolve(stdout.toString());
      },
    );
    child.stdin?.end(prompt);
  });
}
