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

export interface BatchParseResult {
  prs: ParsedPR[];
  invalidCount: number;
}

function dedupe(prs: ParsedPR[]): ParsedPR[] {
  const seen = new Set<string>();
  const out: ParsedPR[] = [];
  for (const p of prs) {
    const key = `${p.owner}/${p.repo}#${p.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

export function parsePRUrls(input: string): BatchParseResult {
  const tokens = input.split(/\s+/).filter((t) => t.length > 0);
  const prs: ParsedPR[] = [];
  let invalidCount = 0;
  for (const tok of tokens) {
    const parsed = parsePRUrl(tok);
    if (parsed) prs.push(parsed);
    else invalidCount++;
  }
  return { prs: dedupe(prs), invalidCount };
}
