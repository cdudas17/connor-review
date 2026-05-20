import { useCallback, useEffect, useState } from 'react';
import { AddPRBar } from './components/AddPRBar.js';
import { PRList } from './components/PRList.js';
import { FilterToggle, type FilterMode } from './components/FilterToggle.js';
import { ReviewDrawer } from './components/ReviewDrawer.js';
import { AuthRequiredBanner } from './components/AuthRequiredBanner.js';
import { ErrorToast } from './components/ErrorToast.js';
import { useTrackedPRs } from './hooks/useTrackedPRs.js';
import { nextUntouchedAfter } from './hooks/useNextPRPrefetch.js';
import { api, ApiCallError } from './lib/api.js';
import type { PRStatus } from './types.js';

interface Identity { owner: string; repo: string; number: number; }
function same(a: Identity, b: Identity) { return a.owner === b.owner && a.repo === b.repo && a.number === b.number; }
function prKey(id: Identity) { return `${id.owner}/${id.repo}#${id.number}`; }

export function App() {
  const { prs, add, setStatus, update } = useTrackedPRs();
  const [mode, setMode] = useState<FilterMode>('untouched-only');
  const [current, setCurrent] = useState<Identity | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [pendingReviews, setPendingReviews] = useState<Record<string, string>>({});

  const handleAdd = useCallback(async (parsed: Identity[]) => {
    if (parsed.length === 0) return;
    setAddError(null);
    for (const p of parsed) {
      add({ owner: p.owner, repo: p.repo, number: p.number, title: `PR #${p.number}`, authorLogin: null });
    }
    const results = await Promise.allSettled(
      parsed.map((p) => api.getPullRequest(p.owner, p.repo, p.number).then((meta) => ({ p, meta }))),
    );
    const failures: ApiCallError[] = [];
    let sawAuthRequired = false;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { p, meta } = r.value;
        update(p, { title: meta.title, authorLogin: meta.authorLogin });
      } else {
        const err = r.reason as ApiCallError;
        console.error('Failed to fetch PR meta', err);
        if (err.code === 'AUTH_REQUIRED') sawAuthRequired = true;
        else failures.push(err);
      }
    }
    if (sawAuthRequired) setAuthRequired(true);
    if (failures.length > 0) {
      setAddError(failures.length === 1
        ? failures[0].message
        : `${failures.length} of ${parsed.length} PRs failed to load metadata. See devtools console for details.`);
    }
  }, [add, update]);

  const handleAdvance = useCallback((id: Identity, newStatus: PRStatus) => {
    setStatus(id, newStatus);
    const projected = prs.map((p) => (same(p, id) ? { ...p, status: newStatus } : p));
    setCurrent(nextUntouchedAfter(id, projected));
  }, [prs, setStatus]);

  useEffect(() => {
    if (!current) return;
    const cur = prs.find((p) => same(p, current));
    if (mode === 'untouched-only' && cur && cur.status !== 'untouched') {
      setCurrent(nextUntouchedAfter(current, prs));
    }
  }, [mode, prs, current]);

  const currentPendingReviewId = current ? (pendingReviews[prKey(current)] ?? null) : null;

  const setPendingReview = useCallback((id: Identity, reviewId: string | null) => {
    setPendingReviews((cur) => {
      const next = { ...cur };
      if (reviewId == null) delete next[prKey(id)];
      else next[prKey(id)] = reviewId;
      return next;
    });
  }, []);

  return (
    <main className="app">
      <header className="app-header">
        <h1>Connor Review</h1>
        <FilterToggle mode={mode} onChange={setMode} />
      </header>
      <AddPRBar onAdd={handleAdd} />
      {addError && <ErrorToast message={addError} onDismiss={() => setAddError(null)} />}
      {authRequired && <AuthRequiredBanner onDismiss={() => setAuthRequired(false)} />}
      <PRList prs={prs} mode={mode} onOpen={setCurrent} />
      {current && (
        <ReviewDrawer
          current={current}
          prs={prs}
          pendingReviewId={currentPendingReviewId}
          onPendingReviewChange={setPendingReview}
          onAdvance={handleAdvance}
          onClose={() => setCurrent(null)}
        />
      )}
    </main>
  );
}
