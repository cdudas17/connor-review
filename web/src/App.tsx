import { useCallback, useEffect, useState } from 'react';
import { AddPRBar } from './components/AddPRBar.js';
import { PRList } from './components/PRList.js';
import { FilterToggle, type FilterMode } from './components/FilterToggle.js';
import { ReviewDrawer } from './components/ReviewDrawer.js';
import { AuthRequiredBanner } from './components/AuthRequiredBanner.js';
import { ErrorToast } from './components/ErrorToast.js';
import { Tabs, type TabId } from './components/Tabs.js';
import { useTrackedPRs } from './hooks/useTrackedPRs.js';
import { useTeamPRs } from './hooks/useTeamPRs.js';
import { nextUntouchedAfter } from './hooks/useNextPRPrefetch.js';
import { api, ApiCallError } from './lib/api.js';
import { computeGhStatus } from './lib/ghStatus.js';
import type { PRStatus, PullRequestMeta, TrackedPR } from './types.js';

interface Identity { owner: string; repo: string; number: number; }
function same(a: Identity, b: Identity) { return a.owner === b.owner && a.repo === b.repo && a.number === b.number; }
function prKey(id: Identity) { return `${id.owner}/${id.repo}#${id.number}`; }

export function App() {
  const myPRs = useTrackedPRs();
  const teamPRs = useTeamPRs();
  const [tab, setTab] = useState<TabId>('my');
  const [mode, setMode] = useState<FilterMode>('untouched-only');
  const [current, setCurrent] = useState<Identity | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [pendingReviews, setPendingReviews] = useState<Record<string, string>>({});
  const [refreshing, setRefreshing] = useState(false);

  // Lazy-load team PRs the first time the Team tab is opened.
  useEffect(() => {
    if (tab === 'team' && !teamPRs.hasLoaded && !teamPRs.loading) {
      teamPRs.fetch();
    }
  }, [tab, teamPRs]);

  // Backfill ciStatus / ghStatus for entries that were saved to localStorage before those
  // fields existed. Runs silently — no banner / no spinner.
  useEffect(() => {
    const stale = myPRs.prs.filter((p) => p.ciStatus === undefined || p.ghStatus == null);
    if (stale.length === 0) return;
    let cancelled = false;
    Promise.allSettled(
      stale.map((p) => api.getPullRequest(p.owner, p.repo, p.number).then((meta) => ({ p, meta }))),
    ).then((results) => {
      if (cancelled) return;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { p, meta } = r.value;
          myPRs.update(p, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus });
        }
      }
    });
    return () => { cancelled = true; };
    // Intentional: run only once on initial load. Re-checking on every prs change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activePRs: TrackedPR[] = tab === 'my' ? myPRs.prs : teamPRs.prs;
  const activeSetStatus = tab === 'my' ? myPRs.setStatus : teamPRs.setStatus;

  // Close the drawer when switching tabs so we don't show a PR from the other list.
  useEffect(() => { setCurrent(null); }, [tab]);

  const handleAdd = useCallback(async (parsed: Identity[]) => {
    if (parsed.length === 0) return;
    setAddError(null);
    for (const p of parsed) {
      myPRs.add({ owner: p.owner, repo: p.repo, number: p.number, title: `PR #${p.number}`, authorLogin: null });
    }
    const results = await Promise.allSettled(
      parsed.map((p) => api.getPullRequest(p.owner, p.repo, p.number).then((meta) => ({ p, meta }))),
    );
    const failures: ApiCallError[] = [];
    let sawAuthRequired = false;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { p, meta } = r.value;
        myPRs.update(p, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus });
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
  }, [myPRs]);

  const handleAdvance = useCallback((id: Identity, newStatus: PRStatus) => {
    activeSetStatus(id, newStatus);
    const projected = activePRs.map((p) => (same(p, id) ? { ...p, status: newStatus } : p));
    setCurrent(nextUntouchedAfter(id, projected));
  }, [activePRs, activeSetStatus]);

  useEffect(() => {
    if (!current) return;
    const cur = activePRs.find((p) => same(p, current));
    if (mode === 'untouched-only' && cur && cur.status !== 'untouched') {
      setCurrent(nextUntouchedAfter(current, activePRs));
    }
  }, [mode, activePRs, current]);

  const currentPendingReviewId = current ? (pendingReviews[prKey(current)] ?? null) : null;

  const handleMetaLoaded = useCallback((id: Identity, meta: PullRequestMeta) => {
    if (tab === 'my') {
      myPRs.update(id, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus });
    }
    // Team list updates only on refresh; we don't bake meta back into it here.
  }, [tab, myPRs]);

  const setPendingReview = useCallback((id: Identity, reviewId: string | null) => {
    setPendingReviews((cur) => {
      const next = { ...cur };
      if (reviewId == null) delete next[prKey(id)];
      else next[prKey(id)] = reviewId;
      return next;
    });
  }, []);

  const refreshAll = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    setAddError(null);
    if (tab === 'my') {
      if (myPRs.prs.length === 0) { setRefreshing(false); return; }
      const results = await Promise.allSettled(
        myPRs.prs.map((p) => api.getPullRequest(p.owner, p.repo, p.number, { fresh: true }).then((meta) => ({ p, meta }))),
      );
      let sawAuthRequired = false;
      const failures: ApiCallError[] = [];
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { p, meta } = r.value;
          myPRs.update(p, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus });
        } else {
          const err = r.reason as ApiCallError;
          console.error('Refresh failed for PR', err);
          if (err.code === 'AUTH_REQUIRED') sawAuthRequired = true;
          else failures.push(err);
        }
      }
      if (sawAuthRequired) setAuthRequired(true);
      if (failures.length > 0) {
        setAddError(failures.length === 1
          ? failures[0].message
          : `${failures.length} of ${myPRs.prs.length} PRs failed to refresh.`);
      }
    } else {
      await teamPRs.fetch();
    }
    setRefreshing(false);
  }, [tab, myPRs, teamPRs, refreshing]);

  const untouchedCount = (list: TrackedPR[]) => list.filter((p) => p.status === 'untouched').length;

  return (
    <main className="app">
      <header className="app-header">
        <h1>Connor Review</h1>
        <div className="app-header-actions">
          <button
            type="button"
            className="refresh-button"
            onClick={refreshAll}
            disabled={refreshing}
            title={tab === 'my' ? 'Refetch metadata for every tracked PR' : 'Refetch the team PR list'}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <FilterToggle mode={mode} onChange={setMode} />
        </div>
      </header>

      <Tabs
        tabs={[
          { id: 'my', label: 'My PRs', badge: untouchedCount(myPRs.prs) || null },
          { id: 'team', label: 'Team PRs', badge: teamPRs.hasLoaded ? (untouchedCount(teamPRs.prs) || null) : null },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'my' && (
        <>
          <AddPRBar onAdd={handleAdd} />
          {addError && <ErrorToast message={addError} onDismiss={() => setAddError(null)} />}
        </>
      )}
      {tab === 'team' && (
        <>
          <p className="tab-context">PRs from <code>Gusto/zenpayroll</code>'s <code>config/teams/people_os/talent.yml</code> — open, non-draft, not yet approved.</p>
          {teamPRs.loading && <p className="empty">Loading team PRs…</p>}
          {teamPRs.error && (
            <ErrorToast
              message={`Failed to load team PRs: ${teamPRs.error.message}`}
              onDismiss={() => { /* user can click Refresh */ }}
            />
          )}
        </>
      )}

      {authRequired && <AuthRequiredBanner onDismiss={() => setAuthRequired(false)} />}

      <PRList prs={activePRs} mode={mode} onOpen={setCurrent} />

      {current && (
        <ReviewDrawer
          current={current}
          prs={activePRs}
          pendingReviewId={currentPendingReviewId}
          onPendingReviewChange={setPendingReview}
          onMetaLoaded={handleMetaLoaded}
          onAdvance={handleAdvance}
          onClose={() => setCurrent(null)}
        />
      )}
    </main>
  );
}
