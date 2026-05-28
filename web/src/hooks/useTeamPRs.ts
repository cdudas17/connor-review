import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import { computeGhStatus } from '../lib/ghStatus.js';
import type { PRStatus, TeamPR, TrackedPR } from '../types.js';

const STATUS_STORAGE_KEY = 'connor-review.teamPRStatus.v1';

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
  members: string[];
  loading: boolean;
  error: ApiCallError | null;
  /** Whether the error toast has been dismissed by the user. Re-armed on every new error. */
  errorDismissed: boolean;
  hasLoaded: boolean;
  lastFetchedAt: number | null;
}

interface Options {
  /** If set, auto-fetch on mount and every N ms (only while the tab is visible). */
  autoRefreshMs?: number;
  /** GitHub repo to read the team file from, e.g. "OrgName/monorepo". */
  repo?: string;
  /** Path inside `repo` to the YAML file with `github.members`. */
  path?: string;
}

/**
 * Fetches team PRs from the server (driven by a configurable team-members YAML file)
 * and merges them with locally-persisted per-PR statuses (untouched/reviewed/approved).
 *
 * `refresh` triggers a fresh fetch. `setStatus` updates the local status for a single PR.
 * Drafts/merged/already-approved PRs are filtered out server-side.
 *
 * If `repo` or `path` are not provided, the Team PRs tab is effectively disabled
 * (the underlying endpoint will reject with no defaults).
 */
export function useTeamPRs(opts: Options = {}) {
  const { autoRefreshMs, repo, path } = opts;
  const isConfigured = !!(repo && path);
  const [state, setState] = useState<State>({ prs: [], members: [], loading: false, error: null, errorDismissed: false, hasLoaded: false, lastFetchedAt: null });
  const [statuses, setStatuses] = useState<Record<string, PRStatus>>(() => loadStatuses());
  const loadingRef = useRef(false);

  useEffect(() => { saveStatuses(statuses); }, [statuses]);

  const fetch = useCallback(async () => {
    if (!isConfigured) {
      // No team file configured — nothing to fetch. Mark loaded so the UI doesn't spin.
      setState((s) => ({ ...s, loading: false, hasLoaded: true, lastFetchedAt: Date.now() }));
      return;
    }
    if (loadingRef.current) return; // skip concurrent fetches — protects against rate-limit bursts
    loadingRef.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { prs, members } = await api.getTeamPRs({ repo, path });
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
        createdAt: p.createdAt,
        addedAt: Date.parse(p.updatedAt) || Date.now(),
      }));
      // Newest PRs first.
      tracked.sort((a, b) => b.addedAt - a.addedAt);
      setState({ prs: tracked, members, loading: false, error: null, errorDismissed: false, hasLoaded: true, lastFetchedAt: Date.now() });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e as ApiCallError, errorDismissed: false, hasLoaded: true, lastFetchedAt: Date.now() }));
    } finally {
      loadingRef.current = false;
    }
  }, [statuses, isConfigured, repo, path]);

  // Auto-refresh: initial fetch on mount, then every autoRefreshMs while the tab is visible.
  // Visibility-aware refresh re-syncs immediately when the user returns to the tab after
  // being away longer than the interval.
  const fetchRef = useRef(fetch);
  useEffect(() => { fetchRef.current = fetch; }, [fetch]);
  const lastFetchedAtRef = useRef<number | null>(null);
  useEffect(() => { lastFetchedAtRef.current = state.lastFetchedAt; }, [state.lastFetchedAt]);

  useEffect(() => {
    if (autoRefreshMs == null) return;
    fetchRef.current();
    const id = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      fetchRef.current();
    }, autoRefreshMs);
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      const last = lastFetchedAtRef.current;
      if (!last || Date.now() - last >= autoRefreshMs) fetchRef.current();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, [autoRefreshMs]);

  const dismissError = useCallback(() => {
    setState((s) => ({ ...s, errorDismissed: true }));
  }, []);

  const setStatus = useCallback((id: Identity, status: PRStatus) => {
    setStatuses((cur) => ({ ...cur, [key(id)]: status }));
    setState((s) => ({
      ...s,
      prs: s.prs.map((p) => (p.owner === id.owner && p.repo === id.repo && p.number === id.number ? { ...p, status } : p)),
    }));
  }, []);

  return { ...state, fetch, setStatus, dismissError };
}
