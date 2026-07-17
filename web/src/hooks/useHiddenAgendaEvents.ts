import { useCallback, useEffect, useState } from 'react';

/**
 * localStorage-backed set of hide keys — see `agendaHide.ts` for how
 * those keys are computed. Persistent across reloads, session-agnostic,
 * capped at a healthy number of entries so a runaway hide-everything
 * spree can't blow the quota.
 */

const STORAGE_KEY = 'connor-review.hiddenAgendaEvents.v1';
const MAX_ENTRIES = 500;

function load(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch { return new Set(); }
}

function save(hidden: Set<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    // Trim to the cap by dropping the oldest (insertion-order) entries.
    let arr = Array.from(hidden);
    if (arr.length > MAX_ENTRIES) arr = arr.slice(arr.length - MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
  } catch { /* quota — ignore */ }
}

export function useHiddenAgendaEvents() {
  const [hidden, setHidden] = useState<Set<string>>(load);
  useEffect(() => { save(hidden); }, [hidden]);

  const hide = useCallback((key: string) => {
    setHidden((cur) => {
      if (cur.has(key)) return cur;
      const next = new Set(cur);
      next.add(key);
      return next;
    });
  }, []);

  const unhide = useCallback((key: string) => {
    setHidden((cur) => {
      if (!cur.has(key)) return cur;
      const next = new Set(cur);
      next.delete(key);
      return next;
    });
  }, []);

  const clear = useCallback(() => { setHidden(new Set()); }, []);

  return { hidden, hide, unhide, clear };
}
