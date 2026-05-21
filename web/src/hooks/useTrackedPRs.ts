import { useCallback, useEffect, useState } from 'react';
import type { PRStatus, TrackedPR } from '../types.js';

export const STORAGE_KEY = 'connor-review.trackedPRs.v1';

interface Identity { owner: string; repo: string; number: number; }
function same(a: Identity, b: Identity) {
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

function load(): TrackedPR[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function save(prs: TrackedPR[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prs));
}

export function useTrackedPRs() {
  const [prs, setPrs] = useState<TrackedPR[]>(() => load());

  useEffect(() => { save(prs); }, [prs]);

  const add = useCallback((pr: Omit<TrackedPR, 'status' | 'addedAt' | 'ghStatus' | 'ciStatus' | 'ciUrl' | 'createdAt'> & Partial<Pick<TrackedPR, 'ghStatus' | 'ciStatus' | 'ciUrl' | 'createdAt'>>) => {
    setPrs((cur) => (cur.some((p) => same(p, pr))
      ? cur
      : [...cur, { ghStatus: null, ciStatus: null, ciUrl: null, createdAt: null, ...pr, status: 'untouched', addedAt: Date.now() }]));
  }, []);

  const remove = useCallback((id: Identity) => {
    setPrs((cur) => cur.filter((p) => !same(p, id)));
  }, []);

  const setStatus = useCallback((id: Identity, status: PRStatus) => {
    setPrs((cur) => cur.map((p) => (same(p, id) ? { ...p, status } : p)));
  }, []);

  const update = useCallback((id: Identity, patch: Partial<Pick<TrackedPR, 'title' | 'authorLogin' | 'ghStatus' | 'ciStatus' | 'ciUrl' | 'createdAt'>>) => {
    setPrs((cur) => cur.map((p) => (same(p, id) ? { ...p, ...patch } : p)));
  }, []);

  return { prs, add, remove, setStatus, update };
}
