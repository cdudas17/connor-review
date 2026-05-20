import { useEffect } from 'react';
import { api } from '../lib/api.js';
import type { TrackedPR } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }
function same(a: Identity, b: Identity) { return a.owner === b.owner && a.repo === b.repo && a.number === b.number; }

interface Args {
  current: Identity | null;
  prs: TrackedPR[];
}

export function nextUntouchedAfter(current: Identity | null, prs: TrackedPR[]): Identity | null {
  if (!current) return null;
  const idx = prs.findIndex((p) => same(p, current));
  if (idx === -1) return null;
  for (let i = idx + 1; i < prs.length; i++) {
    if (prs[i].status === 'untouched') return { owner: prs[i].owner, repo: prs[i].repo, number: prs[i].number };
  }
  return null;
}

export function useNextPRPrefetch({ current, prs }: Args) {
  useEffect(() => {
    const next = nextUntouchedAfter(current, prs);
    if (!next) return;
    // best-effort; swallow errors
    Promise.allSettled([
      api.getPullRequest(next.owner, next.repo, next.number),
      api.getDiff(next.owner, next.repo, next.number),
    ]);
  }, [current?.owner, current?.repo, current?.number, prs]);
}
