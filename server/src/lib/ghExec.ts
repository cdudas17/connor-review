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

export function ghExec(args: string[], opts: GhExecOptions = {}): Promise<string> {
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
