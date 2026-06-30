import { useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';

/** Module-level cache of in-memory issue details. Powers two things:
 *  1. Prefetch — App.tsx warms entries for pinned issues so clicking the row
 *     opens the drawer instantly (no spinner).
 *  2. Hydration — the hook seeds its initial state from this cache so the
 *     first render after a hit shows real content. A live fetch still fires
 *     in the background to catch drift.
 *
 * Not persisted: a session-lifetime Map is enough. Don't need cross-reload
 * survival because the prefetch step covers reopening the tab. */
const detailsCache = new Map<string, IssueDetail>();
function cacheKey(id: IssueId): string { return `${id.owner}/${id.repo}#${id.number}`; }

/** Fire-and-forget prefetch for an issue. Resolves quickly (cache hit) or
 * runs an `api.getIssue` and stashes the result. Swallows errors so a
 * prefetch failure can't surface to the user. */
export function prefetchIssue(id: IssueId): Promise<void> {
  const key = cacheKey(id);
  if (detailsCache.has(key)) return Promise.resolve();
  return api.getIssue(id.owner, id.repo, id.number)
    .then((detail) => { detailsCache.set(key, detail); })
    .catch(() => { /* prefetch failure is non-blocking */ });
}

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
  comments: IssueComment[];
}

export interface IssueComment {
  id: string;
  bodyHtml: string;
  createdAt: string;
  url: string | null;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  authorUrl: string | null;
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
  // Seed initial state from the prefetch cache if available — gives clicked
  // pinned issues an instant render with no spinner.
  const seed = id ? detailsCache.get(cacheKey(id)) ?? null : null;
  const [issue, setIssue] = useState<IssueDetail | null>(seed);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const lastIdRef = useRef<IssueId | null>(null);

  useEffect(() => {
    if (!id) { setIssue(null); setLoading(false); setError(null); lastIdRef.current = null; return; }
    // Switching to a different issue: hydrate from cache if we have it,
    // otherwise clear so we don't briefly show the previous issue.
    const isNewIssue = !sameId(id, lastIdRef.current);
    if (isNewIssue) {
      const cached = detailsCache.get(cacheKey(id));
      setIssue(cached ?? null);
    }
    lastIdRef.current = id;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getIssue(id.owner, id.repo, id.number)
      .then((data) => {
        if (cancelled) return;
        detailsCache.set(cacheKey(id), data);
        setIssue(data);
      })
      .catch((e) => { if (!cancelled) setError(e as ApiCallError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id?.owner, id?.repo, id?.number, reloadKey]);

  return { issue, loading, error, reload: () => setReloadKey((k) => k + 1) };
}
