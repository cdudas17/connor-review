import { useCallback, useEffect, useRef, useState } from 'react';
import { renderNotesToHtml } from '../lib/renderNotes.js';

const STORAGE_KEY = 'connor-review.notes.v1';
const SAVE_DEBOUNCE_MS = 500;

export type SyncStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'offline' | 'error';

function looksLikeHtml(s: string): boolean {
  return /<[a-zA-Z][^>]*>/.test(s);
}

function loadCached(): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) ?? '';
    if (!raw) return '';
    // Existing plain-text/markdown notes — convert once to HTML so the new editor
    // sees them with rendered links.
    return looksLikeHtml(raw) ? raw : renderNotesToHtml(raw);
  } catch { return ''; }
}

/**
 * Notes editor state with file-backed persistence (via the server's /api/notes
 * endpoint, writing to ~/.connor-review/notes.html). localStorage stays as a
 * fast-load cache + offline buffer; the file is the durable source of truth.
 *
 * On mount we reconcile: server wins if both differ (the file may contain
 * changes from another session). If the server is unreachable, we use the
 * local cache and queue saves to retry on every change.
 */
export function useNotes() {
  const [notes, setNotes] = useState<string>(() => loadCached());
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [filePath, setFilePath] = useState<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const saveSeq = useRef(0);
  // Avoid the first effect-write firing a save before the initial fetch settles.
  const initializedRef = useRef(false);

  // Initial reconcile: fetch the server copy, decide who wins.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/notes');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { notes: string; path?: string };
        if (cancelled) return;
        const localNotes = loadCached();
        if (data.path) setFilePath(data.path);
        if (data.notes && data.notes !== localNotes) {
          setNotes(data.notes);
          try { localStorage.setItem(STORAGE_KEY, data.notes); } catch { /* ignore */ }
        } else if (!data.notes && localNotes) {
          // Server file is empty but the browser has content — push it up so the
          // file becomes authoritative for next time.
          await fetch('/api/notes', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ notes: localNotes }),
          });
        }
        setStatus('saved');
      } catch {
        if (cancelled) return;
        setStatus('offline');
      } finally {
        initializedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Mirror to localStorage on every change, then debounce a server save.
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, notes); } catch { /* ignore quota */ }
    if (!initializedRef.current) return; // skip until initial fetch resolves
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus('saving');
    saveTimer.current = window.setTimeout(async () => {
      const seq = ++saveSeq.current;
      try {
        const res = await fetch('/api/notes', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (seq === saveSeq.current) setStatus('saved');
      } catch {
        if (seq === saveSeq.current) setStatus('error');
      }
    }, SAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [notes]);

  const clear = useCallback(() => setNotes(''), []);

  return { notes, setNotes, clear, status, filePath };
}
