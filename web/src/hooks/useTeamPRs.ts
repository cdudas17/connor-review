import { useCallback, useEffect, useState } from 'react';
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
  hasLoaded: boolean;
}

/**
 * Fetches team PRs from the server (driven by Gusto/zenpayroll's talent.yml by default)
 * and merges them with locally-persisted per-PR statuses (untouched/reviewed/approved).
 *
 * `refresh` triggers a fresh fetch. `setStatus` updates the local status for a single PR.
 * Drafts/merged/already-approved PRs are filtered out server-side.
 */
export function useTeamPRs() {
  const [state, setState] = useState<State>({ prs: [], members: [], loading: false, error: null, hasLoaded: false });
  const [statuses, setStatuses] = useState<Record<string, PRStatus>>(() => loadStatuses());

  useEffect(() => { saveStatuses(statuses); }, [statuses]);

  const fetch = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { prs, members } = await api.getTeamPRs();
      const tracked: TrackedPR[] = prs.map((p: TeamPR) => ({
        owner: p.owner,
        repo: p.repo,
        number: p.number,
        title: p.title,
        authorLogin: p.authorLogin,
        status: statuses[key(p)] ?? 'untouched',
        ghStatus: computeGhStatus(p),
        ciStatus: p.ciStatus,
        addedAt: Date.parse(p.updatedAt) || Date.now(),
      }));
      // Newest PRs first.
      tracked.sort((a, b) => b.addedAt - a.addedAt);
      setState({ prs: tracked, members, loading: false, error: null, hasLoaded: true });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e as ApiCallError, hasLoaded: true }));
    }
  }, [statuses]);

  const setStatus = useCallback((id: Identity, status: PRStatus) => {
    setStatuses((cur) => ({ ...cur, [key(id)]: status }));
    setState((s) => ({
      ...s,
      prs: s.prs.map((p) => (p.owner === id.owner && p.repo === id.repo && p.number === id.number ? { ...p, status } : p)),
    }));
  }, []);

  return { ...state, fetch, setStatus };
}
