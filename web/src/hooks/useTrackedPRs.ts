import { useCallback, useEffect, useState } from 'react';
import type { PRStatus, TrackedPR } from '../types.js';

/** Default storage key for the Added PRs tab. */
export const STORAGE_KEY = 'connor-review.trackedPRs.v1';

interface Identity { owner: string; repo: string; number: number; }
function same(a: Identity, b: Identity) {
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

function load(storageKey: string): TrackedPR[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function save(storageKey: string, prs: TrackedPR[]) {
  localStorage.setItem(storageKey, JSON.stringify(prs));
}

interface Options {
  /** localStorage key override — useful when multiple tabs want independent paste-tracked lists. */
  storageKey?: string;
}

export function useTrackedPRs(opts: Options = {}) {
  const storageKey = opts.storageKey ?? STORAGE_KEY;
  const [prs, setPrs] = useState<TrackedPR[]>(() => load(storageKey));

  useEffect(() => { save(storageKey, prs); }, [storageKey, prs]);

  const add = useCallback((pr: Omit<TrackedPR, 'status' | 'addedAt' | 'ghStatus' | 'ciStatus' | 'ciUrl' | 'labels' | 'createdAt'> & Partial<Pick<TrackedPR, 'ghStatus' | 'ciStatus' | 'ciUrl' | 'labels' | 'createdAt'>>) => {
    setPrs((cur) => (cur.some((p) => same(p, pr))
      ? cur
      : [...cur, { ghStatus: null, ciStatus: null, ciUrl: null, labels: [], createdAt: null, ...pr, status: 'untouched', addedAt: Date.now() }]));
  }, []);

  const remove = useCallback((id: Identity) => {
    setPrs((cur) => cur.filter((p) => !same(p, id)));
  }, []);

  const setStatus = useCallback((id: Identity, status: PRStatus) => {
    setPrs((cur) => cur.map((p) => (same(p, id) ? { ...p, status } : p)));
  }, []);

  const update = useCallback((id: Identity, patch: Partial<TrackedPR>) => {
    setPrs((cur) => cur.map((p) => (same(p, id) ? { ...p, ...patch } : p)));
  }, []);

  return { prs, add, remove, setStatus, update };
}
