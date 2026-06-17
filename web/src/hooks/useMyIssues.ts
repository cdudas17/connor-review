import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';

export interface MyIssue {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  authorLogin: string | null;
  repository: string;
  createdAt: string;
  updatedAt: string;
  labels: string[];
}

interface State {
  issues: MyIssue[];
  loading: boolean;
  error: ApiCallError | null;
  hasLoaded: boolean;
  lastFetchedAt: number | null;
}

interface Options {
  /** When true, fetch lazily — only when `enabled` flips to true. */
  enabled: boolean;
  /** 'assigned' (default — only issues I'm assigned to), 'authored', or
   * 'either' (assigned ∪ authored). */
  scope?: 'assigned' | 'authored' | 'either';
  /** When set, restrict results to issues in this GitHub org/user (e.g. 'Gusto'). */
  owner?: string;
  /** When set, refetch every N ms while the document is visible — same
   * pattern as useTeamPRs / useAuthoredPRs. Pairs with the localStorage
   * hydration below: even before the first refetch lands, the tab shows
   * the previously-cached list instantly. */
  autoRefreshMs?: number;
}

const STORAGE_KEY = 'connor-review.myIssues.v1';

interface PersistedShape {
  issues: MyIssue[];
  lastFetchedAt: number | null;
  /** Tracked so a config change (different scope or owner) doesn't show
   * mismatched cached results. */
  scope: string;
  owner: string;
}

function loadCached(scope: string, owner: string): { issues: MyIssue[]; lastFetchedAt: number | null } | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (parsed.scope !== scope || parsed.owner !== owner) return null;
    if (!Array.isArray(parsed.issues)) return null;
    return { issues: parsed.issues, lastFetchedAt: parsed.lastFetchedAt ?? null };
  } catch { return null; }
}

function saveCached(scope: string, owner: string, issues: MyIssue[], lastFetchedAt: number | null) {
  if (typeof localStorage === 'undefined') return;
  try {
    const shape: PersistedShape = { issues, lastFetchedAt, scope, owner };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
  } catch { /* quota; fine */ }
}

/** Fetches the viewer's open GitHub issues. Lazy first fetch (waits for
 * `enabled`), but persists the last result to localStorage so subsequent
 * page loads show the previous list instantly while a fresh fetch runs in
 * the background. Optional auto-refresh keeps the list current the same
 * way the PR tabs do. */
export function useMyIssues(opts: Options) {
  const scope = opts.scope ?? 'either';
  const owner = opts.owner ?? '';
  // Hydrate from localStorage so the tab shows the last-known issues
  // immediately on mount — no flash of empty state on every reload.
  const cached = loadCached(scope, owner);
  const [state, setState] = useState<State>({
    issues: cached?.issues ?? [],
    loading: false,
    error: null,
    hasLoaded: !!cached,
    lastFetchedAt: cached?.lastFetchedAt ?? null,
  });
  const loadingRef = useRef(false);

  // Persist new results so the next mount can hydrate from them.
  useEffect(() => {
    if (state.hasLoaded) saveCached(scope, owner, state.issues, state.lastFetchedAt);
  }, [state.issues, state.lastFetchedAt, state.hasLoaded, scope, owner]);

  const fetch = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { issues } = await api.getMyIssues({ scope, owner: owner || undefined });
      setState({ issues, loading: false, error: null, hasLoaded: true, lastFetchedAt: Date.now() });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e as ApiCallError, hasLoaded: true, lastFetchedAt: Date.now() }));
    } finally {
      loadingRef.current = false;
    }
  }, [scope, owner]);

  // First fetch when `enabled` flips true. If we already hydrated from the
  // cache the visual is instant; the live fetch still fires to catch drift.
  useEffect(() => {
    if (!opts.enabled) return;
    if (!loadingRef.current) void fetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, scope, owner]);

  // Auto-refresh while the tab is visible. Same shape as useTeamPRs:
  // interval + visibilitychange listener to catch up after backgrounding.
  const fetchRef = useRef(fetch);
  useEffect(() => { fetchRef.current = fetch; }, [fetch]);
  const lastFetchedAtRef = useRef<number | null>(null);
  useEffect(() => { lastFetchedAtRef.current = state.lastFetchedAt; }, [state.lastFetchedAt]);

  useEffect(() => {
    if (!opts.enabled || opts.autoRefreshMs == null) return;
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchRef.current();
    }, opts.autoRefreshMs);
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const last = lastFetchedAtRef.current;
      if (!last || Date.now() - last >= (opts.autoRefreshMs ?? 0)) fetchRef.current();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [opts.enabled, opts.autoRefreshMs]);

  return { ...state, refresh: fetch };
}
