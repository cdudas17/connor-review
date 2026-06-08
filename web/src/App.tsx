import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddPRBar } from './components/AddPRBar.js';
import { PRList } from './components/PRList.js';
import { FilterToggle, type FilterMode } from './components/FilterToggle.js';
import { ReviewDrawer } from './components/ReviewDrawer.js';
import { AuthRequiredBanner } from './components/AuthRequiredBanner.js';
import { ErrorToast } from './components/ErrorToast.js';
import { Tabs, type TabId } from './components/Tabs.js';
import { BulkActionsBar } from './components/BulkActionsBar.js';
import { MemberFilter } from './components/MemberFilter.js';
import { OncallStateFilter, type OncallState } from './components/OncallStateFilter.js';
import { NotesFab } from './components/NotesFab.js';
import { ToastStack } from './components/ToastStack.js';
import { useToasts } from './hooks/useToasts.js';
import { useTrackedPRs } from './hooks/useTrackedPRs.js';
import { useTeamPRs } from './hooks/useTeamPRs.js';
import { useLabeledPRs } from './hooks/useLabeledPRs.js';
import { useAuthoredPRs } from './hooks/useAuthoredPRs.js';
import { useViewedPaths } from './hooks/useViewedPaths.js';
import { nextUntouchedAfter } from './hooks/useNextPRPrefetch.js';
import { api, ApiCallError } from './lib/api.js';
import { computeGhStatus } from './lib/ghStatus.js';
import { APP_CONFIG } from './config.js';
import type { PRStatus, PullRequestMeta, TrackedPR } from './types.js';

interface Identity { owner: string; repo: string; number: number; }
function same(a: Identity, b: Identity) { return a.owner === b.owner && a.repo === b.repo && a.number === b.number; }
function prKey(id: Identity) { return `${id.owner}/${id.repo}#${id.number}`; }

/**
 * Friendlier message when the API error is a rate-limit response from GitHub.
 * Otherwise just returns the raw API message.
 */
function describeApiError(err: ApiCallError, what: string): string {
  if (err.code === 'RATE_LIMITED' || err.status === 429) {
    return `${what}: hit GitHub's rate limit. Auto-refresh paused for 10 minutes; manual refresh still works.`;
  }
  return `${what}: ${err.message}`;
}

export function App() {
  const myPRs = useTrackedPRs();
  // Auto-fetch team PRs on app launch and every 5 minutes while the tab is visible.
  // The paginated search can hit GraphQL multiple times per refresh once the team
  // has >100 open PRs, so we keep the interval generous to stay well under the
  // secondary rate limit. The server-side 30s TTL cache absorbs racing refreshes
  // and manual Refresh always bypasses it.
  const teamPRs = useTeamPRs({
    autoRefreshMs: 5 * 60 * 1000,
    repo: APP_CONFIG.teamRepo,
    path: APP_CONFIG.teamYmlPath,
  });
  const minePRs = useAuthoredPRs(APP_CONFIG.myPRsAuthor, { autoRefreshMs: 5 * 60 * 1000 });
  // Separate tracked-PR bucket scoped to the My PRs tab — PRs the user pastes
  // here are kept distinct from the Added PRs tab.
  const mineAddedPRs = useTrackedPRs({ storageKey: 'connor-review.mineAddedPRs.v1' });
  const oncallPRs = useLabeledPRs(APP_CONFIG.oncallLabel);
  const [tab, setTab] = useState<TabId>('my');
  const [mode, setMode] = useState<FilterMode>('all');
  const [current, setCurrent] = useState<Identity | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [pendingReviews, setPendingReviews] = useState<Record<string, string>>({});
  const viewedPaths = useViewedPaths();
  const { toasts, addToast, dismissToast } = useToasts();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [memberFilter, setMemberFilter] = useState<Set<string> | null>(null);
  // Oncall tab state-filter (Draft vs Ready for review). Defaults to Draft only — that's
  // what the on-call person actually needs to triage.
  const [oncallStates, setOncallStates] = useState<Set<OncallState>>(() => new Set<OncallState>(['draft']));

  // First time members load (or when they change), default to "show all".
  useEffect(() => {
    if (teamPRs.members.length === 0) return;
    setMemberFilter((cur) => cur ?? new Set(teamPRs.members));
  }, [teamPRs.members]);

  // Backfill ciStatus / ghStatus for entries that were saved to localStorage before those
  // fields existed. Runs silently — no banner / no spinner.
  useEffect(() => {
    const stale = myPRs.prs.filter((p) => p.ciStatus === undefined || p.ghStatus == null || p.createdAt === undefined || p.createdAt == null);
    if (stale.length === 0) return;
    let cancelled = false;
    Promise.allSettled(
      stale.map((p) => api.getPullRequest(p.owner, p.repo, p.number).then((meta) => ({ p, meta }))),
    ).then((results) => {
      if (cancelled) return;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          const { p, meta } = r.value;
          myPRs.update(p, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus, ciUrl: meta.ciUrl, labels: meta.labels ?? [], createdAt: meta.createdAt });
        }
      }
    });
    return () => { cancelled = true; };
    // Intentional: run only once on initial load. Re-checking on every prs change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredTeamPRs = useMemo(() => {
    // No member chips selected → empty list. (memberFilter === null happens briefly
    // before the talent.yml fetch resolves; treat the same as "nothing selected".)
    if (!memberFilter || memberFilter.size === 0) return [];
    return teamPRs.prs.filter((p) => p.authorLogin != null && memberFilter.has(p.authorLogin));
  }, [teamPRs.prs, memberFilter]);

  const filteredOncallPRs = useMemo(() => {
    if (oncallStates.size === 0) return [];
    return oncallPRs.prs.filter((p) => {
      const state: OncallState = p.isDraft ? 'draft' : 'ready';
      return oncallStates.has(state);
    });
  }, [oncallPRs.prs, oncallStates]);

  /**
   * Combined My PRs list = authored (auto-fetched) ∪ manually-added (pasted).
   * Dedupe by `owner/repo/number`. Authored entries win on conflict because
   * their meta comes fresh from the API on every refresh.
   */
  const combinedMinePRs = useMemo(() => {
    const seen = new Set<string>();
    const out: TrackedPR[] = [];
    for (const p of minePRs.prs) {
      seen.add(prKey(p));
      out.push(p);
    }
    for (const p of mineAddedPRs.prs) {
      if (seen.has(prKey(p))) continue;
      seen.add(prKey(p));
      out.push(p);
    }
    return out.sort((a, b) => b.addedAt - a.addedAt);
  }, [minePRs.prs, mineAddedPRs.prs]);

  const oncallCountsByState: Record<OncallState, number> = useMemo(() => {
    const c: Record<OncallState, number> = { draft: 0, ready: 0 };
    for (const p of oncallPRs.prs) c[p.isDraft ? 'draft' : 'ready']++;
    return c;
  }, [oncallPRs.prs]);

  const toggleOncallState = useCallback((s: OncallState) => {
    setOncallStates((cur) => {
      const next = new Set(cur);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  }, []);
  const selectAllOncallStates = useCallback(() => setOncallStates(new Set<OncallState>(['draft', 'ready'])), []);
  const clearAllOncallStates = useCallback(() => setOncallStates(new Set<OncallState>()), []);

  const activePRs: TrackedPR[] =
    tab === 'my' ? myPRs.prs
    : tab === 'mine' ? combinedMinePRs
    : tab === 'team' ? filteredTeamPRs
    : filteredOncallPRs;
  // For setStatus on the My PRs tab, route to whichever underlying list owns
  // the PR: authored ones go to the authored hook, pasted ones to the tracked
  // hook. If a PR id ends up in both, prefer authored (matches the dedupe rule).
  const setMineStatus = useCallback((id: { owner: string; repo: string; number: number }, status: PRStatus) => {
    const inAuthored = minePRs.prs.some((p) => same(p, id));
    if (inAuthored) minePRs.setStatus(id, status);
    else mineAddedPRs.setStatus(id, status);
  }, [minePRs, mineAddedPRs]);
  const activeSetStatus =
    tab === 'my' ? myPRs.setStatus
    : tab === 'mine' ? setMineStatus
    : tab === 'team' ? teamPRs.setStatus
    : oncallPRs.setStatus;

  const teamPRCountByMember = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of teamPRs.prs) {
      if (p.authorLogin) counts[p.authorLogin] = (counts[p.authorLogin] ?? 0) + 1;
    }
    return counts;
  }, [teamPRs.prs]);

  const toggleMember = useCallback((login: string) => {
    setMemberFilter((cur) => {
      const base = cur ?? new Set(teamPRs.members);
      const next = new Set(base);
      if (next.has(login)) next.delete(login);
      else next.add(login);
      return next;
    });
  }, [teamPRs.members]);

  const selectAllMembers = useCallback(() => setMemberFilter(new Set(teamPRs.members)), [teamPRs.members]);
  const clearAllMembers = useCallback(() => setMemberFilter(new Set()), []);

  // Close the drawer + clear any selection when switching tabs.
  useEffect(() => { setCurrent(null); setSelectedKeys(new Set()); }, [tab]);

  // Visible PRs after the untouched-only filter (matches what PRList renders).
  const visiblePRs = useMemo(
    () => (mode === 'untouched-only' ? activePRs.filter((p) => p.status === 'untouched') : activePRs),
    [activePRs, mode],
  );

  const toggleSelect = useCallback((id: Identity) => {
    setSelectedKeys((cur) => {
      const next = new Set(cur);
      const k = prKey(id);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), []);

  const deleteSelected = useCallback(() => {
    if (selectedKeys.size === 0) return;
    const ok = window.confirm(`Delete ${selectedKeys.size} PR${selectedKeys.size === 1 ? '' : 's'} from the list? (This only removes them from this app — it doesn't affect the PR on GitHub.)`);
    if (!ok) return;
    // Route each removal to the right list. Added tab uses `myPRs`; the My PRs
    // tab's pasted bucket is `mineAddedPRs`. Authored entries on the My tab
    // aren't selectable (PRList skips checkboxes for them), so we won't hit them.
    const removeFn = tab === 'mine' ? mineAddedPRs.remove : myPRs.remove;
    for (const p of activePRs) {
      if (selectedKeys.has(prKey(p))) {
        removeFn({ owner: p.owner, repo: p.repo, number: p.number });
      }
    }
    setSelectedKeys(new Set());
    if (current && selectedKeys.has(prKey(current))) setCurrent(null);
  }, [selectedKeys, activePRs, myPRs, mineAddedPRs, tab, current]);

  /**
   * Optimistically add a batch of PRs to `target` (one of the tracked-PR hooks),
   * then fetch meta in parallel and patch each entry as it resolves.
   */
  const addPRsTo = useCallback(async (parsed: Identity[], target: typeof myPRs) => {
    if (parsed.length === 0) return;
    setAddError(null);
    for (const p of parsed) {
      target.add({ owner: p.owner, repo: p.repo, number: p.number, title: `PR #${p.number}`, authorLogin: null });
    }
    const results = await Promise.allSettled(
      parsed.map((p) => api.getPullRequest(p.owner, p.repo, p.number).then((meta) => ({ p, meta }))),
    );
    const failures: ApiCallError[] = [];
    let sawAuthRequired = false;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        const { p, meta } = r.value;
        target.update(p, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus, ciUrl: meta.ciUrl, labels: meta.labels ?? [], createdAt: meta.createdAt });
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
  }, []);

  const handleAdd = useCallback((parsed: Identity[]) => addPRsTo(parsed, myPRs), [addPRsTo, myPRs]);
  const handleAddMine = useCallback((parsed: Identity[]) => addPRsTo(parsed, mineAddedPRs), [addPRsTo, mineAddedPRs]);

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
      myPRs.update(id, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus, createdAt: meta.createdAt });
    }
    // Reflect any server-side pending review state into the client so the UI knows
    // to show "Add review comment" / "Finish your review" instead of "Start a review".
    setPendingReviews((cur) => {
      const k = prKey(id);
      const existing = cur[k];
      if (meta.viewerPendingReviewId && existing !== meta.viewerPendingReviewId) {
        return { ...cur, [k]: meta.viewerPendingReviewId };
      }
      if (!meta.viewerPendingReviewId && existing) {
        const next = { ...cur }; delete next[k]; return next;
      }
      return cur;
    });
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
          myPRs.update(p, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus, ciUrl: meta.ciUrl, labels: meta.labels ?? [], createdAt: meta.createdAt });
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
    } else if (tab === 'mine') {
      // Refresh both lists: re-search authored PRs AND re-fetch meta for any
      // manually-pasted PRs (these don't auto-refresh on their own).
      const refreshAuthored = minePRs.fetch({ fresh: true });
      const refreshPasted = Promise.allSettled(
        mineAddedPRs.prs.map((p) => api.getPullRequest(p.owner, p.repo, p.number, { fresh: true }).then((meta) => ({ p, meta }))),
      ).then((results) => {
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const { p, meta } = r.value;
            mineAddedPRs.update(p, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus, ciUrl: meta.ciUrl, labels: meta.labels ?? [], createdAt: meta.createdAt });
          }
        }
      });
      await Promise.all([refreshAuthored, refreshPasted]);
    } else if (tab === 'team') {
      await teamPRs.fetch({ fresh: true });
    } else {
      await oncallPRs.fetch({ fresh: true });
    }
    setRefreshing(false);
  }, [tab, myPRs, minePRs, mineAddedPRs, teamPRs, oncallPRs, refreshing]);

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
            title={tab === 'my' ? 'Refetch metadata for every tracked PR' : tab === 'mine' ? 'Refetch your authored PRs' : tab === 'team' ? 'Refetch the team PR list' : 'Refetch the on-call list'}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <FilterToggle mode={mode} onChange={setMode} />
        </div>
      </header>

      <Tabs
        tabs={[
          { id: 'my', label: 'Added PRs', badge: untouchedCount(myPRs.prs) || null },
          ...(APP_CONFIG.myPRsAuthor
            ? [{ id: 'mine' as const, label: 'My PRs', badge: combinedMinePRs.length || null }]
            : []),
          { id: 'team', label: 'Team PRs', badge: teamPRs.hasLoaded ? (untouchedCount(teamPRs.prs) || null) : null },
          { id: 'oncall', label: `Oncall (${APP_CONFIG.oncallLabel})`, badge: oncallPRs.hasLoaded ? (untouchedCount(oncallPRs.prs) || null) : null },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'my' && (() => {
        const approvedCount = myPRs.prs.filter((p) => p.status === 'approved').length;
        const removeApproved = () => {
          if (approvedCount === 0) return;
          const ok = window.confirm(`Remove ${approvedCount} approved PR${approvedCount === 1 ? '' : 's'} from the Added list? (This only removes them from this app — it doesn't affect the PR on GitHub.)`);
          if (!ok) return;
          for (const p of myPRs.prs.filter((pr) => pr.status === 'approved')) {
            myPRs.remove({ owner: p.owner, repo: p.repo, number: p.number });
          }
        };
        return (
          <>
            <AddPRBar onAdd={handleAdd} onRemoveApproved={removeApproved} approvedCount={approvedCount} />
            {addError && <ErrorToast message={addError} onDismiss={() => setAddError(null)} />}
          </>
        );
      })()}
      {tab === 'oncall' && (
        <>
          {APP_CONFIG.oncallLinks.length > 0 && (() => {
            // Render ungrouped links first, then each named group as its own row.
            const ungrouped = APP_CONFIG.oncallLinks.filter((l) => !l.group);
            const groups = new Map<string, typeof APP_CONFIG.oncallLinks>();
            for (const l of APP_CONFIG.oncallLinks) {
              if (!l.group) continue;
              const arr = groups.get(l.group) ?? [];
              arr.push(l);
              groups.set(l.group, arr);
            }
            return (
              <>
                {ungrouped.length > 0 && (
                  <p className="oncall-external-links">
                    {ungrouped.map((link) => (
                      <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                        {link.label}
                      </a>
                    ))}
                  </p>
                )}
                {[...groups.entries()].map(([name, links]) => (
                  <div key={name} className="oncall-link-group">
                    <span className="oncall-link-group-label">{name}</span>
                    <p className="oncall-external-links">
                      {links.map((link) => (
                        <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer">
                          {link.label}
                        </a>
                      ))}
                    </p>
                  </div>
                ))}
              </>
            );
          })()}
          {!oncallPRs.hasLoaded ? (
            <div className="oncall-empty">
              <p>Pull all open, non-draft, non-approved PRs labeled <code>{APP_CONFIG.oncallLabel}</code>.</p>
              <p className="oncall-note">Manual fetch — this can be a large list, so it isn't auto-refreshed.</p>
              <button
                type="button"
                className="btn-primary oncall-fetch-button"
                onClick={() => oncallPRs.fetch({ fresh: true })}
                disabled={oncallPRs.loading}
              >
                {oncallPRs.loading ? 'Loading…' : `Load ${APP_CONFIG.oncallLabel} PRs`}
              </button>
            </div>
          ) : (
            <>
              <p className="tab-context">
                <span className="tab-context-freshness">
                  {oncallPRs.prs.length} PRs · last loaded {oncallPRs.lastFetchedAt ? new Date(oncallPRs.lastFetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '—'}
                  {oncallPRs.loading && <span className="loading-spinner" aria-label="Refreshing" />}
                  {' · '}
                  <button type="button" className="link-button" onClick={() => oncallPRs.fetch({ fresh: true })} disabled={oncallPRs.loading}>Refresh now</button>
                </span>
              </p>
              <OncallStateFilter
                selected={oncallStates}
                countsByState={oncallCountsByState}
                onToggle={toggleOncallState}
                onSelectAll={selectAllOncallStates}
                onClearAll={clearAllOncallStates}
              />
            </>
          )}
          {oncallPRs.error && !oncallPRs.errorDismissed && (
            <ErrorToast
              message={describeApiError(oncallPRs.error, `Failed to load ${APP_CONFIG.oncallLabel} PRs`)}
              onDismiss={oncallPRs.dismissError}
            />
          )}
        </>
      )}
      {tab === 'mine' && (
        <>
          {minePRs.lastFetchedAt && (
            <p className="tab-context">
              <span className="tab-context-freshness">
                Open PRs authored by <code>{APP_CONFIG.myPRsAuthor}</code> · auto-refreshes every 5 minutes · last updated {new Date(minePRs.lastFetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                {minePRs.loading && <span className="loading-spinner" aria-label="Refreshing" />}
              </span>
            </p>
          )}
          {!minePRs.lastFetchedAt && minePRs.loading && (
            <p className="tab-context">
              <span className="tab-context-freshness">loading my PRs<span className="loading-spinner" aria-label="Loading" /></span>
            </p>
          )}
          {minePRs.error && !minePRs.errorDismissed && (
            <ErrorToast
              message={describeApiError(minePRs.error, 'Failed to load my PRs')}
              onDismiss={minePRs.dismissError}
            />
          )}
          <AddPRBar onAdd={handleAddMine} />
          {addError && <ErrorToast message={addError} onDismiss={() => setAddError(null)} />}
        </>
      )}
      {tab === 'team' && (
        <>
          {teamPRs.lastFetchedAt && (
            <p className="tab-context">
              <span className="tab-context-freshness">
                auto-refreshes every minute · last updated {new Date(teamPRs.lastFetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                {teamPRs.loading && <span className="loading-spinner" aria-label="Refreshing" />}
              </span>
            </p>
          )}
          {!teamPRs.lastFetchedAt && teamPRs.loading && (
            <p className="tab-context">
              <span className="tab-context-freshness">loading team PRs<span className="loading-spinner" aria-label="Loading" /></span>
            </p>
          )}
          {teamPRs.error && !teamPRs.errorDismissed && (
            <ErrorToast
              message={describeApiError(teamPRs.error, 'Failed to load team PRs')}
              onDismiss={teamPRs.dismissError}
            />
          )}
          {teamPRs.members.length > 0 && (
            <MemberFilter
              members={teamPRs.members}
              selected={memberFilter ?? new Set(teamPRs.members)}
              countsByMember={teamPRCountByMember}
              onToggle={toggleMember}
              onSelectAll={selectAllMembers}
              onClearAll={clearAllMembers}
            />
          )}
        </>
      )}

      {authRequired && <AuthRequiredBanner onDismiss={() => setAuthRequired(false)} />}

      {/* Bulk-delete bar — shown on the Added tab (everything is selectable) and on
          the My PRs tab (only pasted entries are selectable). */}
      {(tab === 'my' || tab === 'mine') && (() => {
        const isSelectable = tab === 'my'
          ? () => true
          : (id: Identity) => mineAddedPRs.prs.some((p) => same(p, id));
        const selectableVisible = visiblePRs.filter((p) => isSelectable({ owner: p.owner, repo: p.repo, number: p.number }));
        if (selectableVisible.length === 0) return null;
        return (
          <BulkActionsBar
            selectedCount={selectedKeys.size}
            totalVisible={selectableVisible.length}
            allSelected={selectableVisible.length > 0 && selectableVisible.every((p) => selectedKeys.has(prKey(p)))}
            onSelectAll={() => setSelectedKeys(new Set(selectableVisible.map(prKey)))}
            onClear={clearSelection}
            onDelete={deleteSelected}
          />
        );
      })()}

      <PRList
        prs={activePRs}
        mode={mode}
        onOpen={setCurrent}
        {...(tab === 'my'
          ? { selection: { selectedKeys, onToggle: toggleSelect } }
          : tab === 'mine'
          ? {
              selection: {
                selectedKeys,
                onToggle: toggleSelect,
                isSelectable: (id) => mineAddedPRs.prs.some((p) => same(p, id)),
              },
            }
          : {})}
      />

      {current && (() => {
        const tracked = activePRs.find((p) => same(p, current));
        const idx = activePRs.findIndex((p) => same(p, current));
        const prevPr = idx > 0 ? activePRs[idx - 1] : null;
        const nextPr = idx >= 0 && idx < activePRs.length - 1 ? activePRs[idx + 1] : null;
        const toIdentity = (p: TrackedPR): Identity => ({ owner: p.owner, repo: p.repo, number: p.number });
        return (
          <ReviewDrawer
            current={current}
            prs={activePRs}
            pendingReviewId={currentPendingReviewId}
            latestGhStatus={tracked?.ghStatus}
            latestCiStatus={tracked?.ciStatus}
            latestCiUrl={tracked?.ciUrl}
            viewedPaths={viewedPaths.getViewedFor(current)}
            onViewedChange={(p, v) => viewedPaths.setViewed(current, p, v)}
            onPendingReviewChange={setPendingReview}
            onMetaLoaded={handleMetaLoaded}
            onAdvance={handleAdvance}
            onNavigatePrev={() => prevPr && setCurrent(toIdentity(prevPr))}
            onNavigateNext={() => nextPr && setCurrent(toIdentity(nextPr))}
            canNavigatePrev={!!prevPr}
            canNavigateNext={!!nextPr}
            onToast={addToast}
            onSetStatus={activeSetStatus}
            onClose={() => setCurrent(null)}
          />
        );
      })()}
      <NotesFab />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
