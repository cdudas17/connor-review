import { useEffect } from 'react';
import type { TrackedPR } from '../types.js';
import { prefetchPR } from './usePRDetails.js';

interface Identity {
  owner: string;
  repo: string;
  number: number;
  source?: 'github' | 'local';
  branch?: string;
  localPath?: string;
  localRepo?: string;
}
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
    if (prs[i].status === 'untouched') {
      const p = prs[i];
      return {
        owner: p.owner,
        repo: p.repo,
        number: p.number,
        source: p.source,
        branch: p.branch,
        localPath: p.localPath,
      };
    }
  }
  return null;
}

export function useNextPRPrefetch({ current, prs }: Args) {
  useEffect(() => {
    const next = nextUntouchedAfter(current, prs);
    if (!next) return;
    // prefetchPR stashes the parsed response in a client-side cache so
    // usePRDetails can hydrate synchronously when the user clicks Next
    // — avoiding the loading spinner that shows up if we only warm the
    // server-side cache. Swallows errors; the real fetch will surface
    // them normally when the drawer actually opens the PR.
    void prefetchPR(next);
  }, [current?.owner, current?.repo, current?.number, prs]);
}
