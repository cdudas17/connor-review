import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Shells out to the user's local `codex` CLI in non-interactive `exec`
 * mode and returns the agent's final message. Sibling to `claudeExec`;
 * used by the "Ask AI" review-chat surface, which the user asked
 * to run on Codex instead. Prompt is written via stdin (NOT argv) so
 * we don't trip argv-length limits with large diffs.
 *
 * Uses `-o <file>` so we get the model's final message clean, rather
 * than having to parse the surrounding session banner + "tokens used"
 * footer that codex prints on stdout.
 *
 * Defaults to `--sandbox read-only` — this endpoint is for *reviewing*
 * an implementation, not modifying it, so we don't want the model
 * writing or shelling out. `--skip-git-repo-check` because cwd may
 * point at a subdir or nothing (falls back to server cwd).
 */
export type CodexErrorCode = 'CODEX_NOT_INSTALLED' | 'TIMEOUT' | 'CODEX_FAILED';

export class CodexCliError extends Error {
  override readonly name = 'CodexCliError';
  constructor(
    readonly code: CodexErrorCode,
    message: string,
    readonly stderr: string,
  ) {
    super(message);
  }
}

export interface CodexExecOptions {
  /** Hard timeout in ms; default 300_000 (5 min). */
  timeoutMs?: number;
  /** Working directory the agent should treat as its workspace root. */
  cwd?: string;
  /** Sandbox mode — defaults to workspace-write so `gh` / `bktide` /
   *  network-touching shell tools work. Codex's `read-only` mode
   *  blocks network at the seatbelt level on macOS, which broke the
   *  review-chat flow (couldn't fetch PR threads, CI logs, etc.).
   *  workspace-write still restricts writes to the working dir; the
   *  prompt itself frames the AI as read-only review. */
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access';
  /** Model override (e.g. 'gpt-5.6-terra'). Omitted → uses config default. */
  model?: string;
  /** Allow the sandbox to reach the network. Only meaningful when
   *  sandbox is 'workspace-write' (Codex's read-only mode always
   *  blocks network, no config override). Default true for
   *  workspace-write so gh / bktide just work. */
  network?: boolean;
}

export function codexExec(prompt: string, opts: CodexExecOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const sandbox = opts.sandbox ?? 'workspace-write';
  const network = opts.network ?? true;
  // Codex writes the final assistant message to this file. Cleaner than
  // parsing the stdout banner ("OpenAI Codex vX", "session id: …",
  // "tokens used", …).
  const dir = mkdtempSync(join(tmpdir(), 'codex-exec-'));
  const outFile = join(dir, 'last.txt');
  const args = [
    'exec',
    '--sandbox', sandbox,
    '--skip-git-repo-check',
    '-o', outFile,
  ];
  // Enable network only when it makes sense — workspace-write is the
  // sandbox that supports the `sandbox_workspace_write.network_access`
  // config override. Codex silently ignores the flag under read-only.
  if (network && sandbox === 'workspace-write') {
    args.push('-c', 'sandbox_workspace_write.network_access=true');
  }
  if (opts.cwd) args.push('-C', opts.cwd);
  if (opts.model) args.push('-m', opts.model);
  // Read prompt from stdin (`-` sentinel) so we don't hit argv limits
  // on large diff-embedded prompts.
  args.push('-');
  return new Promise((resolve, reject) => {
    const child = execFile('codex', args, { maxBuffer: 50 * 1024 * 1024, timeout: timeoutMs, cwd: opts.cwd }, (err, _stdout, stderr) => {
      const stderrStr = stderr.toString();
      if (err) {
        rmSync(dir, { recursive: true, force: true });
        const errno = (err as NodeJS.ErrnoException).code;
        if (errno === 'ENOENT') {
          reject(new CodexCliError('CODEX_NOT_INSTALLED', 'codex CLI not found (install via: brew install codex / https://openai.com/codex)', stderrStr));
          return;
        }
        if ((err as NodeJS.ErrnoException & { killed?: boolean }).killed) {
          reject(new CodexCliError('TIMEOUT', `codex exec timed out after ${timeoutMs}ms`, stderrStr));
          return;
        }
        reject(new CodexCliError('CODEX_FAILED', `codex exec failed: ${stderrStr.trim() || (err as Error).message}`, stderrStr));
        return;
      }
      let last = '';
      try { last = readFileSync(outFile, 'utf8'); }
      catch (readErr) {
        rmSync(dir, { recursive: true, force: true });
        reject(new CodexCliError('CODEX_FAILED', `codex exec produced no output file: ${(readErr as Error).message}`, stderrStr));
        return;
      }
      rmSync(dir, { recursive: true, force: true });
      resolve(last);
    });
    child.stdin?.end(prompt);
  });
}
