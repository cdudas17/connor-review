import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import { computeGhStatus } from '../lib/ghStatus.js';
import type { PRStatus, TeamPR, TrackedPR } from '../types.js';

const STATUS_STORAGE_KEY = 'connor-review.labeledPRStatus.v1';

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

/**
 * Fetches PRs that carry a given label (e.g. "needs-review"). Manual-only —
 * no auto-refresh — since the result set can be large and the user only
 * needs it when on-call.
 */
export function useLabeledPRs(label = 'needs-review') {
  const [state, setState] = useState<State>({ prs: [], loading: false, error: null, errorDismissed: false, hasLoaded: false, lastFetchedAt: null });
  const [statuses, setStatuses] = useState<Record<string, PRStatus>>(() => loadStatuses());
  const loadingRef = useRef(false);

  useEffect(() => { saveStatuses(statuses); }, [statuses]);

  const fetch = useCallback(async (fetchOpts?: { fresh?: boolean }) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { prs } = await api.getLabeledPRs(label, { fresh: fetchOpts?.fresh });
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
        hasConflicts: !!p.hasConflicts,
        trunkInQueue: !!p.trunkInQueue,
        ciCounts: p.ciCounts,
        approvers: p.approvers,
        metaFetchedAt: Date.now(),
      }));
      tracked.sort((a, b) => b.addedAt - a.addedAt);
      setState({ prs: tracked, loading: false, error: null, errorDismissed: false, hasLoaded: true, lastFetchedAt: Date.now() });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e as ApiCallError, errorDismissed: false, hasLoaded: true, lastFetchedAt: Date.now() }));
    } finally {
      loadingRef.current = false;
    }
  }, [label, statuses]);

  const setStatus = useCallback((id: Identity, status: PRStatus) => {
    setStatuses((cur) => ({ ...cur, [key(id)]: status }));
    setState((s) => ({
      ...s,
      prs: s.prs.map((p) => (p.owner === id.owner && p.repo === id.repo && p.number === id.number ? { ...p, status } : p)),
    }));
  }, []);

  /** Patch a single PR in-place — same shape/intent as useTrackedPRs.update. */
  const update = useCallback((id: Identity, patch: Partial<TrackedPR>) => {
    setState((s) => ({
      ...s,
      prs: s.prs.map((p) => (p.owner === id.owner && p.repo === id.repo && p.number === id.number ? { ...p, ...patch } : p)),
    }));
  }, []);

  const dismissError = useCallback(() => {
    setState((s) => ({ ...s, errorDismissed: true }));
  }, []);

  return { ...state, fetch, setStatus, dismissError, update };
}
