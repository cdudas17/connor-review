import { useCallback, useEffect, useRef, useState } from 'react';
import { renderNotesToHtml } from '../lib/renderNotes.js';

/**
 * Multi-project notes state. Replaces `useNotes` (single body) with a
 * list of projects and per-project body state, persisted server-side
 * under `~/.connor-review/notes/<slug>.html`. Selected-project id is
 * cached in localStorage so a reload reopens the last panel you were
 * on.
 *
 * Save flow is per-project debounced — editing project A doesn't
 * flush project B. `misc` is the sticky default; the server guarantees
 * it always exists and refuses delete/rename on it.
 */

const SAVE_DEBOUNCE_MS = 500;
const SELECTION_KEY = 'connor-review.notesSelectedProject.v1';
const MISC_SLUG = 'misc';

export type ProjectSyncStatus = 'idle' | 'loading' | 'saving' | 'saved' | 'offline' | 'error';

export interface NoteProject {
  slug: string;
  name: string;
}

function looksLikeHtml(s: string): boolean {
  return /<[a-zA-Z][^>]*>/.test(s);
}

/** One-shot: migrate the legacy single-body localStorage cache into an
 *  in-memory misc project body if we don't have server data yet. */
function loadLegacyCache(): string {
  try {
    const raw = localStorage.getItem('connor-review.notes.v1') ?? '';
    if (!raw) return '';
    return looksLikeHtml(raw) ? raw : renderNotesToHtml(raw);
  } catch { return ''; }
}

export function useNoteProjects() {
  const [projects, setProjects] = useState<NoteProject[]>([{ slug: MISC_SLUG, name: 'Misc' }]);
  const [selected, setSelected] = useState<string>(() => {
    try { return localStorage.getItem(SELECTION_KEY) || MISC_SLUG; }
    catch { return MISC_SLUG; }
  });
  // Body cache — one entry per slug we've fetched.
  const [bodies, setBodies] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<ProjectSyncStatus>('loading');
  // Debounced save timers keyed by slug — editing one project shouldn't
  // reset another's pending save.
  const saveTimers = useRef<Record<string, number>>({});
  const saveSeq = useRef<Record<string, number>>({});
  // Set of slugs whose in-memory body has not been synced from server
  // yet — used to skip the first "did-change" save on load.
  const hydratedRef = useRef<Set<string>>(new Set());

  // Persist the selection so the panel reopens where you left it.
  useEffect(() => {
    try { localStorage.setItem(SELECTION_KEY, selected); } catch { /* ignore */ }
  }, [selected]);

  // Initial project list fetch. If offline, seed a misc entry with the
  // legacy cache body so notes don't disappear from view during outages.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/notes/projects');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { projects: list } = (await res.json()) as { projects: Array<{ slug: string; name: string }> };
        if (cancelled) return;
        setProjects(list);
        // If the currently-selected slug isn't in the fetched list
        // anymore (e.g. deleted from another tab), fall back to misc.
        if (!list.some((p) => p.slug === selected)) {
          setSelected(MISC_SLUG);
        }
        setStatus('saved');
      } catch {
        if (cancelled) return;
        // Offline path: keep misc alone in the sidebar and pre-seed its
        // body from the legacy localStorage cache so pre-project users
        // still see their notes.
        const cached = loadLegacyCache();
        if (cached) setBodies((b) => ({ ...b, [MISC_SLUG]: cached }));
        hydratedRef.current.add(MISC_SLUG);
        setStatus('offline');
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- initial fetch only
  }, []);

  // Whenever the selection changes, fetch that project's body if we
  // don't already have it in memory.
  useEffect(() => {
    if (bodies[selected] !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/notes/projects/${selected}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { notes: string };
        if (cancelled) return;
        setBodies((b) => ({ ...b, [selected]: data.notes ?? '' }));
        hydratedRef.current.add(selected);
        setStatus('saved');
      } catch {
        if (cancelled) return;
        setBodies((b) => ({ ...b, [selected]: '' }));
        hydratedRef.current.add(selected);
        setStatus('offline');
      }
    })();
    return () => { cancelled = true; };
  }, [selected, bodies]);

  /** Update the body of the currently-selected (or specified) project.
   *  Kicks off a debounced server save. */
  const setBody = useCallback((slug: string, html: string) => {
    setBodies((cur) => ({ ...cur, [slug]: html }));
    if (!hydratedRef.current.has(slug)) return; // pre-hydration edit — no save yet
    if (saveTimers.current[slug]) window.clearTimeout(saveTimers.current[slug]);
    setStatus('saving');
    saveTimers.current[slug] = window.setTimeout(async () => {
      const seq = (saveSeq.current[slug] ?? 0) + 1;
      saveSeq.current[slug] = seq;
      try {
        const res = await fetch(`/api/notes/projects/${slug}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ notes: html }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (seq === saveSeq.current[slug]) setStatus('saved');
      } catch {
        if (seq === saveSeq.current[slug]) setStatus('error');
      }
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const createProject = useCallback(async (name: string): Promise<NoteProject | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    try {
      const res = await fetch('/api/notes/projects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const p = (await res.json()) as NoteProject;
      setProjects((cur) => [...cur, p]);
      // Fresh project starts with an empty body — pre-populate the cache
      // so the editor doesn't spin on first select.
      setBodies((cur) => ({ ...cur, [p.slug]: '' }));
      hydratedRef.current.add(p.slug);
      setSelected(p.slug);
      return p;
    } catch {
      setStatus('error');
      return null;
    }
  }, []);

  const removeProject = useCallback(async (slug: string): Promise<boolean> => {
    if (slug === MISC_SLUG) return false;
    try {
      const res = await fetch(`/api/notes/projects/${slug}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProjects((cur) => cur.filter((p) => p.slug !== slug));
      setBodies((cur) => {
        const { [slug]: _drop, ...rest } = cur;
        void _drop;
        return rest;
      });
      if (selected === slug) setSelected(MISC_SLUG);
      return true;
    } catch {
      setStatus('error');
      return false;
    }
  }, [selected]);

  const renameProject = useCallback(async (slug: string, name: string): Promise<boolean> => {
    if (slug === MISC_SLUG) return false;
    const trimmed = name.trim();
    if (!trimmed) return false;
    try {
      const res = await fetch(`/api/notes/projects/${slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setProjects((cur) => cur.map((p) => (p.slug === slug ? { ...p, name: trimmed } : p)));
      return true;
    } catch {
      setStatus('error');
      return false;
    }
  }, []);

  const currentBody = bodies[selected] ?? '';
  const canDelete = selected !== MISC_SLUG;
  const canRename = selected !== MISC_SLUG;

  return {
    projects,
    selected,
    setSelected,
    currentBody,
    setBody: (html: string) => setBody(selected, html),
    createProject,
    removeProject,
    renameProject,
    status,
    canDelete,
    canRename,
  };
}
