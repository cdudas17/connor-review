import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'connor-review.notes.v1';

function load(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch { return ''; }
}

/**
 * A single free-form notes blob that follows the user across the app. Persisted
 * to localStorage on every keystroke (debounced lightly by React batching).
 */
export function useNotes() {
  const [notes, setNotes] = useState<string>(() => load());

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, notes); } catch { /* ignore quota */ }
  }, [notes]);

  const clear = useCallback(() => setNotes(''), []);

  return { notes, setNotes, clear };
}
