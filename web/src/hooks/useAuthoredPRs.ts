import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import { computeGhStatus } from '../lib/ghStatus.js';
import type { PRStatus, TeamPR, TrackedPR } from '../types.js';

const STATUS_STORAGE_KEY = 'connor-review.authoredPRStatus.v1';

interface Identity { owner: string; repo: string; number: number; }
function key(id: Identity) { return `${id.owner}/${id.repo}#${id.number}`; }

function loadStatuses(): Record<string, PRStatus> {
  try {
    const raw = localStorage.getItem(STATUS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed != null ? parsed : {};
  } catch { return {}; }
}

function saveStatuses(statuses: Record<string, PRStatus>) {
  localStorage.setItem(STATUS_STORAGE_KEY, JSON.stringify(statuses));
}

interface State {
  prs: TrackedPR[];
  loading: boolean;
  error: ApiCallError | null;
  errorDismissed: boolean;
  hasLoaded: boolean;
  lastFetchedAt: number | null;
}

interface Options {
  /** If set, auto-fetch on mount and every N ms (only while the tab is visible). */
  autoRefreshMs?: number;
}

/**
 * Fetches PRs authored by the given GitHub login (e.g. your own). Drafts and
 * approved-but-unmerged PRs are kept — the author still owns the next move.
 *
 * If `author` is empty, the hook stays inert (no requests fire) so leaving
 * the config field blank cleanly disables the My PRs tab.
 */
export function useAuthoredPRs(author: string, opts: Options = {}) {
  const { autoRefreshMs } = opts;
  const [state, setState] = useState<State>({ prs: [], loading: false, error: null, errorDismissed: false, hasLoaded: false, lastFetchedAt: null });
  const [statuses, setStatuses] = useState<Record<string, PRStatus>>(() => loadStatuses());
  const loadingRef = useRef(false);

  useEffect(() => { saveStatuses(statuses); }, [statuses]);

  // Same rate-limit pause pattern as useTeamPRs.
  const rateLimitedUntilRef = useRef<number>(0);

  const fetch = useCallback(async () => {
    if (!author) {
      setState((s) => ({ ...s, loading: false, hasLoaded: true, lastFetchedAt: Date.now() }));
      return;
    }
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { prs } = await api.getAuthoredPRs(author);
      const tracked: TrackedPR[] = prs.map((p: TeamPR) => ({
        owner: p.owner,
        repo: p.repo,
        number: p.number,
        title: p.title,
        authorLogin: p.authorLogin,
        status: statuses[key(p)] ?? 'untouched',
        ghStatus: computeGhStatus(p),
        ciStatus: p.ciStatus,
        ciUrl: p.ciUrl,
        labels: p.labels ?? [],
        isDraft: p.isDraft,
        createdAt: p.createdAt,
        addedAt: Date.parse(p.updatedAt) || Date.now(),
      }));
      tracked.sort((a, b) => b.addedAt - a.addedAt);
      setState({ prs: tracked, loading: false, error: null, errorDismissed: false, hasLoaded: true, lastFetchedAt: Date.now() });
      rateLimitedUntilRef.current = 0;
    } catch (e) {
      const err = e as ApiCallError;
      if (err.code === 'RATE_LIMITED' || err.status === 429) {
        rateLimitedUntilRef.current = Date.now() + 10 * 60 * 1000;
      }
      setState((s) => ({ ...s, loading: false, error: err, errorDismissed: false, hasLoaded: true, lastFetchedAt: Date.now() }));
    } finally {
      loadingRef.current = false;
    }
  }, [author, statuses]);

  const setStatus = useCallback((id: Identity, status: PRStatus) => {
    setStatuses((cur) => ({ ...cur, [key(id)]: status }));
    setState((s) => ({
      ...s,
      prs: s.prs.map((p) => (p.owner === id.owner && p.repo === id.repo && p.number === id.number ? { ...p, status } : p)),
    }));
  }, []);

  const dismissError = useCallback(() => {
    setState((s) => ({ ...s, errorDismissed: true }));
  }, []);

  // Auto-refresh with visibility-aware skipping (same pattern as useTeamPRs).
  const fetchRef = useRef(fetch);
  useEffect(() => { fetchRef.current = fetch; }, [fetch]);
  const lastFetchedAtRef = useRef<number | null>(null);
  useEffect(() => { lastFetchedAtRef.current = state.lastFetchedAt; }, [state.lastFetchedAt]);

  useEffect(() => {
    if (autoRefreshMs == null) return;
    fetchRef.current();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      if (Date.now() < rateLimitedUntilRef.current) return; // GitHub said back off
      fetchRef.current();
    }, autoRefreshMs);
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() < rateLimitedUntilRef.current) return;
      const last = lastFetchedAtRef.current;
      if (!last || Date.now() - last >= autoRefreshMs) fetchRef.current();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [autoRefreshMs]);

  return { ...state, fetch, setStatus, dismissError };
}
