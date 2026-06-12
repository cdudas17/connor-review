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
  /** When true, fetch lazily — only when `enabled` flips to true. Used by the
   * FAB so we don't burn a `gh search` on every app load. */
  enabled: boolean;
  /** 'assigned' (default — only issues I'm assigned to), 'authored', or
   * 'either' (assigned ∪ authored). */
  scope?: 'assigned' | 'authored' | 'either';
}

/** Fetches the viewer's open GitHub issues. Lazy — first fetch fires only when
 * `enabled` flips true (usually when the user opens the FAB panel). After
 * that, subsequent enables reuse the cached list; an explicit `refresh()`
 * refetches. */
export function useMyIssues(opts: Options) {
  const [state, setState] = useState<State>({ issues: [], loading: false, error: null, hasLoaded: false, lastFetchedAt: null });
  const loadingRef = useRef(false);

  const fetch = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      // Default scope is 'either' so users see both issues assigned to them
      // AND issues they opened themselves.
      const { issues } = await api.getMyIssues({ scope: opts.scope ?? 'either' });
      setState({ issues, loading: false, error: null, hasLoaded: true, lastFetchedAt: Date.now() });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e as ApiCallError, hasLoaded: true, lastFetchedAt: Date.now() }));
    } finally {
      loadingRef.current = false;
    }
  }, [opts.scope]);

  // Lazy first fetch: kick off when `enabled` first goes true.
  useEffect(() => {
    if (!opts.enabled) return;
    if (!state.hasLoaded && !loadingRef.current) {
      void fetch();
    }
  }, [opts.enabled, state.hasLoaded, fetch]);

  return { ...state, refresh: fetch };
}
