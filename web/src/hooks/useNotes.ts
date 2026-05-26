import { useCallback, useEffect, useState } from 'react';
import { renderNotesToHtml } from '../lib/renderNotes.js';

const STORAGE_KEY = 'connor-review.notes.v1';

/** Returns true if `s` looks like HTML (contains any tag). */
function looksLikeHtml(s: string): boolean {
  return /<[a-zA-Z][^>]*>/.test(s);
}

function load(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? '';
    if (!raw) return '';
    // Existing plain-text/markdown notes — convert once to HTML so the new editor
    // sees them with rendered links.
    return looksLikeHtml(raw) ? raw : renderNotesToHtml(raw);
  } catch { return ''; }
}

/**
 * A single free-form notes blob (HTML) that follows the user across the app.
 * Persisted to localStorage on every change.
 */
export function useNotes() {
  const [notes, setNotes] = useState<string>(() => load());

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, notes); } catch { /* ignore quota */ }
  }, [notes]);

  const clear = useCallback(() => setNotes(''), []);

  return { notes, setNotes, clear };
}
