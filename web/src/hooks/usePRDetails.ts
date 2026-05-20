import { useEffect, useState } from 'react';
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

export function usePRDetails(id: Identity | null): Result {
  const [meta, setMeta] = useState<PullRequestMeta | null>(null);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiCallError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!id) { setMeta(null); setDiff(null); setLoading(false); setError(null); return; }
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
