import { useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import type { PullRequestMeta } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }
/** Optional shape for local-source entries — when source==='local', `localPath` + `branch` + `localRepo` route to /api/local/*. */
interface LocalIdentityExtras {
  source?: 'github' | 'local';
  localPath?: string;
  branch?: string;
  localRepo?: string;
}
type Id = Identity & LocalIdentityExtras;

/** Module-level cache of prefetched PR details. Powers `useNextPRPrefetch`
 * → seamless "Next" transitions: the next-untouched PR's meta + diff are
 * pulled in the background while the user reviews the current one, and
 * `usePRDetails` reads from this cache on new-PR mount so the drawer
 * renders instantly with real content instead of the loading spinner.
 *
 * Not persisted — session-lifetime Map is enough; a fresh prefetch runs
 * whenever the drawer opens the previous PR again.
 */
interface CachedPRDetails { meta: PullRequestMeta; diff: string; fetchedAt: number; }
const detailsCache = new Map<string, CachedPRDetails>();
const inFlight = new Map<string, Promise<CachedPRDetails>>();
function cacheKey(id: Id): string { return `${id.owner}/${id.repo}#${id.number}`; }

/** Fire-and-forget prefetch. Resolves quickly on cache hit or in-flight
 * promise; otherwise fetches meta+diff and stashes the result. Swallows
 * errors so a background prefetch failure never surfaces to the user
 * (they'll see the same error again — with real UI treatment — if they
 * navigate to that PR). */
export function prefetchPR(id: Id): Promise<void> {
  const key = cacheKey(id);
  if (detailsCache.has(key)) return Promise.resolve();
  const existing = inFlight.get(key);
  if (existing) return existing.then(() => {}, () => {});
  const isLocal = id.source === 'local' && !!id.localPath && !!id.branch;
  const p: Promise<[PullRequestMeta, string]> = isLocal
    ? Promise.all([
        api.getLocalMeta(id.repo, id.localPath!, id.branch!),
        api.getLocalDiff(id.localPath!, id.branch!),
      ])
    : Promise.all([
        api.getPullRequest(id.owner, id.repo, id.number),
        api.getDiff(id.owner, id.repo, id.number),
      ]);
  const wrapped: Promise<CachedPRDetails> = p.then(([meta, diff]) => {
    const value: CachedPRDetails = { meta, diff, fetchedAt: Date.now() };
    detailsCache.set(key, value);
    inFlight.delete(key);
    return value;
  }, (err) => {
    inFlight.delete(key);
    throw err;
  });
  inFlight.set(key, wrapped);
  return wrapped.then(() => {}, () => {});
}

/** After a mutation (approve, comment) the drawer's Next transition needs
 * the freshest meta — a stale prefetch would show the just-passed PR
 * still marked untouched. Callers invoke this when they know the cached
 * copy is out of date. */
export function invalidatePRDetails(id: Id): void {
  const key = cacheKey(id);
  detailsCache.delete(key);
  inFlight.delete(key);
}

/** Test-only: wipe the module-level cache so cases can't contaminate
 * each other via a prior test's fetch response. */
export function _resetPRDetailsCacheForTests(): void {
  detailsCache.clear();
  inFlight.clear();
}
interface Result {
  loading: boolean;
  meta: PullRequestMeta | null;
  diff: string | null;
  error: ApiCallError | null;
  reload: () => void;
  /** Epoch ms when the current `meta` was fetched. Used by the App to
   * decide whether the drawer's data should overwrite a list row — if the
   * list refreshed more recently, the list wins. */
  metaFetchedAt: number | null;
}

function sameId(a: Id | null, b: Id | null) {
  if (!a || !b) return a === b;
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

export function usePRDetails(id: Id | null): Result {
  // Seed initial state from the prefetch cache if available — this is what
  // makes "Next" feel instant. When the App advances `current` to the next
  // untouched PR, that PR's meta + diff have already been prefetched by
  // useNextPRPrefetch; reading them synchronously here lets ReviewDrawer's
  // `!meta || diff == null` check pass immediately, so the loading spinner
  // never appears. A background refresh still runs to catch drift.
  const seed = id ? detailsCache.get(cacheKey(id)) ?? null : null;
  const [meta, setMeta] = useState<PullRequestMeta | null>(seed?.meta ?? null);
  const [metaFetchedAt, setMetaFetchedAt] = useState<number | null>(seed?.fetchedAt ?? null);
  const [diff, setDiff] = useState<string | null>(seed?.diff ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Track the id we last rendered for, so we can detect a PR change vs. a same-PR reload.
  const lastIdRef = useRef<Id | null>(null);

  useEffect(() => {
    if (!id) { setMeta(null); setDiff(null); setLoading(false); setError(null); lastIdRef.current = null; return; }
    // PR changed:
    //  - If we have a prefetched entry, hydrate from it so the drawer
    //    renders instantly (no loading spinner). Still fire a fresh
    //    background fetch to catch drift.
    //  - Otherwise clear meta+diff so the drawer doesn't briefly render
    //    the previous PR's content (which makes optimistic Approve/Next
    //    feel like it stalled).
    // Same-PR reload (only reloadKey bumped) → keep the rendered data to
    // avoid a flicker.
    const isNewPr = !sameId(id, lastIdRef.current);
    if (isNewPr) {
      const cached = detailsCache.get(cacheKey(id));
      if (cached) {
        setMeta(cached.meta);
        setDiff(cached.diff);
        setMetaFetchedAt(cached.fetchedAt);
      } else {
        setMeta(null);
        setMetaFetchedAt(null);
        setDiff(null);
      }
    }
    lastIdRef.current = id;
    let cancelled = false;
    setLoading(true);
    setError(null);
    // For local entries we use id.repo as the short repo name (App.tsx adds local PRs
    // with owner='local', repo=<localRepos key>). Don't require id.localRepo — it's
    // duplicative and most call sites that pass an Identity through don't set it.
    const isLocal = id.source === 'local' && !!id.localPath && !!id.branch;
    const fetcher = isLocal
      ? Promise.all([
          api.getLocalMeta(id.repo, id.localPath!, id.branch!),
          api.getLocalDiff(id.localPath!, id.branch!, { fresh: reloadKey > 0 }),
        ])
      : Promise.all([
          api.getPullRequest(id.owner, id.repo, id.number, { fresh: reloadKey > 0 }),
          api.getDiff(id.owner, id.repo, id.number, { fresh: reloadKey > 0 }),
        ]);
    fetcher
      .then(([m, d]) => {
        // Populate the cache even when this call was cancelled — the
        // response is still useful for the next visit. Only skip the
        // React state update, since the effect has moved on.
        const now = Date.now();
        detailsCache.set(cacheKey(id), { meta: m, diff: d, fetchedAt: now });
        if (cancelled) return;
        setMeta(m); setDiff(d); setMetaFetchedAt(now);
      })
      .catch((e) => { if (!cancelled) setError(e as ApiCallError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id?.owner, id?.repo, id?.number, id?.source, id?.localPath, id?.branch, reloadKey]);

  return { meta, diff, loading, error, reload: () => setReloadKey((k) => k + 1), metaFetchedAt };
}
