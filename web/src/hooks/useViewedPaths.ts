import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'connor-review.viewedPaths.v1';

interface Identity { owner: string; repo: string; number: number; }
function prKey(id: Identity) { return `${id.owner}/${id.repo}#${id.number}`; }

function load(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function save(state: Record<string, string[]>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/**
 * Tracks the set of "Viewed" file paths per PR. Persists to localStorage so
 * a closed-and-reopened drawer remembers which files you'd already checked off.
 */
export function useViewedPaths() {
  const [byPr, setByPr] = useState<Record<string, string[]>>(() => load());

  useEffect(() => { save(byPr); }, [byPr]);

  const getViewedFor = useCallback((id: Identity | null): Set<string> => {
    if (!id) return new Set();
    return new Set(byPr[prKey(id)] ?? []);
  }, [byPr]);

  const setViewed = useCallback((id: Identity, path: string, viewed: boolean) => {
    setByPr((cur) => {
      const k = prKey(id);
      const set = new Set(cur[k] ?? []);
      if (viewed) set.add(path); else set.delete(path);
      return { ...cur, [k]: Array.from(set) };
    });
  }, []);

  return useMemo(() => ({ getViewedFor, setViewed }), [getViewedFor, setViewed]);
}
