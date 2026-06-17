import { useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';

export interface IssueDetail {
  id: string;
  number: number;
  title: string;
  bodyHtml: string;
  state: 'open' | 'closed';
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  assignees: Array<{ login: string; avatarUrl: string | null; url: string | null }>;
  labels: Array<{ name: string; color: string }>;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface IssueId { owner: string; repo: string; number: number; }

interface Result {
  loading: boolean;
  issue: IssueDetail | null;
  error: ApiCallError | null;
  /** Force a refetch (e.g. after the user comments on GitHub and reopens). */
  reload: () => void;
}

function sameId(a: IssueId | null, b: IssueId | null) {
  if (!a || !b) return a === b;
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

/** Fetches a single issue's full detail. Identical shape to `usePRDetails`
 * so future drawer chrome refactors can share code. Clears prior state on
 * a different issue (so we don't briefly render stale content) and keeps
 * it on a same-id reload (no flicker). */
export function useIssueDetails(id: IssueId | null): Result {
  const [issue, setIssue] = useState<IssueDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const lastIdRef = useRef<IssueId | null>(null);

  useEffect(() => {
    if (!id) { setIssue(null); setLoading(false); setError(null); lastIdRef.current = null; return; }
    const isNewIssue = !sameId(id, lastIdRef.current);
    if (isNewIssue) setIssue(null);
    lastIdRef.current = id;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getIssue(id.owner, id.repo, id.number)
      .then((data) => { if (!cancelled) setIssue(data); })
      .catch((e) => { if (!cancelled) setError(e as ApiCallError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id?.owner, id?.repo, id?.number, reloadKey]);

  return { issue, loading, error, reload: () => setReloadKey((k) => k + 1) };
}
