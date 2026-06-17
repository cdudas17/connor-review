import { useCallback, useEffect, useState } from 'react';

/** Tiny per-issue "pinned to the top" preference. Persisted to localStorage
 * as a sorted array of `${owner}/${repo}#${number}` keys so the format is
 * easy to inspect / edit by hand if you ever need to. */

const STORAGE_KEY = 'connor-review.pinnedIssues.v1';

function load(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch { return new Set(); }
}

function save(pinned: Set<string>) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...pinned].sort())); }
  catch { /* quota — fine */ }
}

export function pinnedIssueKey(t: { owner: string; repo: string; number: number }): string {
  return `${t.owner}/${t.repo}#${t.number}`;
}

export function usePinnedIssues() {
  const [pinned, setPinned] = useState<Set<string>>(() => load());
  useEffect(() => { save(pinned); }, [pinned]);

  const toggle = useCallback((key: string) => {
    setPinned((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);
  const isPinned = useCallback((key: string) => pinned.has(key), [pinned]);

  return { pinned, isPinned, toggle };
}
