export interface ParsedPR { owner: string; repo: string; number: number; }

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[\/?#].*)?$/;

export function parsePRUrl(input: string): ParsedPR | null {
  try {
    const u = new URL(input.trim());
    if (u.hostname !== 'github.com') return null;
    const match = PR_PATH.exec(u.pathname);
    if (!match) return null;
    return { owner: match[1], repo: match[2], number: Number(match[3]) };
  } catch {
    return null;
  }
}
