import { useCallback, useEffect, useState } from 'react';
import { AddPRBar } from './components/AddPRBar.js';
import { PRList } from './components/PRList.js';
import { FilterToggle, type FilterMode } from './components/FilterToggle.js';
import { ReviewDrawer } from './components/ReviewDrawer.js';
import { AuthRequiredBanner } from './components/AuthRequiredBanner.js';
import { ErrorToast } from './components/ErrorToast.js';
import { useTrackedPRs } from './hooks/useTrackedPRs.js';
import { useDrafts } from './hooks/useDrafts.js';
import { nextUntouchedAfter } from './hooks/useNextPRPrefetch.js';
import { api, ApiCallError } from './lib/api.js';
import type { PRStatus } from './types.js';

interface Identity { owner: string; repo: string; number: number; }
function same(a: Identity, b: Identity) { return a.owner === b.owner && a.repo === b.repo && a.number === b.number; }

export function App() {
  const { prs, add, setStatus } = useTrackedPRs();
  const drafts = useDrafts();
  const [mode, setMode] = useState<FilterMode>('untouched-only');
  const [current, setCurrent] = useState<Identity | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);

  const handleAdd = useCallback(async (parsed: Identity) => {
    setAddError(null);
    try {
      const meta = await api.getPullRequest(parsed.owner, parsed.repo, parsed.number);
      add({ owner: parsed.owner, repo: parsed.repo, number: parsed.number, title: meta.title, authorLogin: meta.authorLogin });
    } catch (e) {
      const err = e as ApiCallError;
      if (err.code === 'AUTH_REQUIRED') setAuthRequired(true);
      else setAddError(err.message);
    }
  }, [add]);

  const handleAdvance = useCallback((id: Identity, newStatus: PRStatus) => {
    setStatus(id, newStatus);
    // Project the new status onto the current list so nextUntouchedAfter sees the up-to-date row.
    const projected = prs.map((p) => (same(p, id) ? { ...p, status: newStatus } : p));
    setCurrent(nextUntouchedAfter(id, projected));
  }, [prs, setStatus]);

  // If the drawer's current PR is hidden by the active filter (e.g. status no longer untouched
  // while mode === 'untouched-only'), jump to the next untouched PR or close.
  useEffect(() => {
    if (!current) return;
    const cur = prs.find((p) => same(p, current));
    if (mode === 'untouched-only' && cur && cur.status !== 'untouched') {
      setCurrent(nextUntouchedAfter(current, prs));
    }
  }, [mode, prs, current]);

  const currentDrafts = current ? drafts.getDrafts(current) : { summary: '', inlineComments: [], replies: [] };
  const currentHasDrafts = current ? drafts.hasAny(current) : false;

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
          drafts={currentDrafts}
          hasDrafts={currentHasDrafts}
          onSummaryChange={(id, v) => drafts.setSummary(id, v)}
          onAddInlineComment={(id, c) => drafts.addInlineComment(id, c)}
          onRemoveInlineComment={(id, idx) => drafts.removeInlineComment(id, idx)}
          onAddReply={(id, r) => drafts.addReply(id, r)}
          onClearDrafts={(id) => drafts.clear(id)}
          onAdvance={handleAdvance}
          onClose={() => setCurrent(null)}
        />
      )}
    </main>
  );
}
