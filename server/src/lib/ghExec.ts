import { execFile } from 'node:child_process';

export type GhErrorCode = 'AUTH_REQUIRED' | 'GH_API_ERROR' | 'GH_CLI_FAILED';

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

function classify(stderr: string): GhErrorCode {
  if (AUTH_PATTERNS.some((r) => r.test(stderr))) return 'AUTH_REQUIRED';
  if (GRAPHQL_PATTERNS.some((r) => r.test(stderr))) return 'GH_API_ERROR';
  return 'GH_CLI_FAILED';
}

export function ghExec(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { maxBuffer: 20 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const code = classify(stderr || (err as Error).message);
        reject(new GhCliError(code, `gh ${args.join(' ')} failed: ${stderr.trim()}`, stderr));
        return;
      }
      resolve(stdout);
    });
  });
}
