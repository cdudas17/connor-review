import { useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import type { PullRequestMeta } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }
interface Result {
  loading: boolean;
  meta: PullRequestMeta | null;
  diff: string | null;
  error: ApiCallError | null;
  reload: () => void;
}

function sameId(a: Identity | null, b: Identity | null) {
  if (!a || !b) return a === b;
  return a.owner === b.owner && a.repo === b.repo && a.number === b.number;
}

export function usePRDetails(id: Identity | null): Result {
  const [meta, setMeta] = useState<PullRequestMeta | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // Track the id we last rendered for, so we can detect a PR change vs. a same-PR reload.
  const lastIdRef = useRef<Identity | null>(null);

  useEffect(() => {
    if (!id) { setMeta(null); setDiff(null); setLoading(false); setError(null); lastIdRef.current = null; return; }
    // PR changed → clear stale meta/diff so the drawer doesn't briefly render the previous
    // PR's content (which makes optimistic Approve/Next feel like it stalled).
    // Same-PR reload (only reloadKey bumped) → keep the rendered data to avoid a flicker.
    const isNewPr = !sameId(id, lastIdRef.current);
    if (isNewPr) {
      setMeta(null);
      setDiff(null);
    }
    lastIdRef.current = id;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.getPullRequest(id.owner, id.repo, id.number, { fresh: reloadKey > 0 }),
      api.getDiff(id.owner, id.repo, id.number, { fresh: reloadKey > 0 }),
    ])
      .then(([m, d]) => {
        if (cancelled) return;
        setMeta(m); setDiff(d);
      })
      .catch((e) => { if (!cancelled) setError(e as ApiCallError); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id?.owner, id?.repo, id?.number, reloadKey]);

  return { meta, diff, loading, error, reload: () => setReloadKey((k) => k + 1) };
}
