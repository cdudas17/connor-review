import { useCallback, useEffect, useMemo, useState } from 'react';
import { AddPRBar } from './components/AddPRBar.js';
import { AddLocalBranchBar } from './components/AddLocalBranchBar.js';
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
import { IssuesFab } from './components/IssuesFab.js';
import { ToastStack } from './components/ToastStack.js';
import { useToasts } from './hooks/useToasts.js';
import { useTrackedPRs } from './hooks/useTrackedPRs.js';
import { useClaudeResponses } from './hooks/useClaudeResponses.js';
import { useConflictResolutions } from './hooks/useConflictResolutions.js';
import { useCiFixes } from './hooks/useCiFixes.js';
import { MentionsProvider } from './contexts/MentionsContext.js';
import { useTeamPRs } from './hooks/useTeamPRs.js';
import { useLabeledPRs } from './hooks/useLabeledPRs.js';
import { useAuthoredPRs } from './hooks/useAuthoredPRs.js';
import { useViewedPaths } from './hooks/useViewedPaths.js';
import { nextUntouchedAfter } from './hooks/useNextPRPrefetch.js';
import { api, ApiCallError } from './lib/api.js';
import { computeGhStatus } from './lib/ghStatus.js';
import { APP_CONFIG } from './config.js';
import type { PRStatus, PullRequestMeta, TrackedPR } from './types.js';

interface Identity {
  owner: string;
  repo: string;
  number: number;
  /** Optional local-source plumbing — present only for Local tab entries. */
  source?: 'github' | 'local';
  branch?: string;
  localPath?: string;
  localRepo?: string;
}
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
  // GitHub's GraphQL backend returns 504 when our search query is too heavy
  // for it to compute in time — common for large team PR lists. The raw `gh`
  // CLI message is unactionable; rephrase to something the user can do
  // something about.
  if (/\bHTTP 504\b/i.test(err.message) || /couldn't respond to your request in time/i.test(err.message)) {
    return `${what}: GitHub timed out (HTTP 504) — this query is heavy on their backend. The list will retry on the next auto-refresh; you can also hit Refresh manually.`;
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
  // Local-branch entries: stable identity is `owner='local', repo=<configured name>,
  // number=<stable hash of branch>`. Stored separately so they don't mix with the
  // Added PRs list. Source-tagged when added (see addLocalBranch below).
  const localPRs = useTrackedPRs({ storageKey: 'connor-review.localBranches.v1' });
  const localRepoNames = useMemo(() => Object.keys(APP_CONFIG.localRepos ?? {}), []);
  const [tab, setTab] = useState<TabId>('my');
  const [mode, setMode] = useState<FilterMode>('all');
  const [current, setCurrent] = useState<Identity | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [pendingReviews, setPendingReviews] = useState<Record<string, string>>({});
  const viewedPaths = useViewedPaths();
  const { toasts, addToast, dismissToast } = useToasts();
  // Claude responses live at App level so they survive drawer close + PR nav
  // (summary card per PR, thread reply cards per PR + threadId, both persisted
  // to localStorage). When an in-flight request resolves after the drawer's no
  // longer on that PR, the hook fires a toast.
  const currentPRKey = useMemo(() => (current ? prKey(current) : null), [current]);
  const claudeResponses = useClaudeResponses({
    onToast: addToast,
    currentPRKey,
    // Resolve a local checkout from `localRepos` so `claude -p` can grep the
    // actual repo. For GitHub PRs, owner/repo is e.g. Gusto/zenpayroll —
    // we match on the short repo name. Local-tab entries already have
    // owner='local' + repo=<shortName> (which is also a localRepos key).
    repoPathFor: (target) => APP_CONFIG.localRepos?.[target.repo],
  });
  // Conflict-resolution state — distinct from claudeResponses so the
  // ClaudeBadge never reads this activity (per the user's "don't count
  // toward the Claude badge" rule).
  const conflictResolutions = useConflictResolutions();
  // Same idea for the "Fix failing CI" flow — its own localStorage bucket.
  const ciFixes = useCiFixes();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [memberFilter, setMemberFilter] = useState<Set<string> | null>(null);
  // Team tab: when true, hide any PR whose CI rollup isn't SUCCESS (red, pending,
  // error, missing). Persisted across reloads so it survives tab refreshes.
  const [teamGreenCiOnly, setTeamGreenCiOnly] = useState<boolean>(() => {
    try { return localStorage.getItem('connor-review.teamGreenCiOnly.v1') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('connor-review.teamGreenCiOnly.v1', teamGreenCiOnly ? '1' : '0'); } catch { /* ignore */ }
  }, [teamGreenCiOnly]);
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
    return teamPRs.prs.filter((p) => {
      if (p.authorLogin == null || !memberFilter.has(p.authorLogin)) return false;
      // Green-CI filter: drop anything whose CI rollup isn't SUCCESS. EXPECTED
      // (the GitHub state for "checks not yet reported") counts as not-green
      // since it usually means CI hasn't even started.
      if (teamGreenCiOnly && p.ciStatus !== 'SUCCESS') return false;
      return true;
    });
  }, [teamPRs.prs, memberFilter, teamGreenCiOnly]);

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
    : tab === 'local' ? localPRs.prs
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
    : tab === 'local' ? localPRs.setStatus
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
        const id = { owner: p.owner, repo: p.repo, number: p.number };
        removeFn(id);
        // Drop any Claude state tied to the deleted PR so we don't carry orphans.
        claudeResponses.dismissAllForPR(id);
      }
    }
    setSelectedKeys(new Set());
    if (current && selectedKeys.has(prKey(current))) setCurrent(null);
  }, [selectedKeys, activePRs, myPRs, mineAddedPRs, tab, current, claudeResponses]);

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

  const handleMetaLoaded = useCallback((id: Identity, meta: PullRequestMeta, fetchedAt: number = Date.now()) => {
    // Push the freshest meta we got from the drawer fetch into whichever
    // list-level store actually owns this PR. Previously this only updated the
    // Added PRs list (`myPRs`); team/oncall/mine rows stayed stale until the
    // next 5-minute auto-refresh — so a freshly-added auto-label, a new thread,
    // or a CI flip wasn't visible in the row count or chips until you hit
    // Refresh manually.
    //
    // BUT: only patch a list row when the drawer's fetch is newer than the
    // row's last refresh. If the list auto-refresh fired more recently, the
    // list already has the source of truth — letting the drawer's older meta
    // win would silently rewind the row (the "table defers to drawer" bug).
    const patch = {
      title: meta.title,
      authorLogin: meta.authorLogin,
      ghStatus: computeGhStatus(meta),
      ciStatus: meta.ciStatus,
      ciUrl: meta.ciUrl,
      labels: meta.labels ?? [],
      createdAt: meta.createdAt,
      autoMergeEnabled: meta.autoMergeRequest != null,
      mergeQueueQueued: meta.mergeQueueEntry != null,
      hasConflicts: meta.mergeable === 'CONFLICTING',
      trunkInQueue: !!meta.trunkInQueue,
      metaFetchedAt: fetchedAt,
    };
    /** Newest-wins guard: a row whose `metaFetchedAt` is greater than the
     * incoming `fetchedAt` was refreshed by the list more recently than this
     * drawer fetch. Skip it — patching would overwrite newer data with
     * older. Rows that have never been stamped (undefined) accept the patch
     * since they have no claim to freshness. */
    const isNewer = (rowFetchedAt: number | undefined): boolean =>
      rowFetchedAt == null || rowFetchedAt <= fetchedAt;
    const updateIfNewer = (
      store: { prs: TrackedPR[]; update: (id: Identity, patch: Partial<TrackedPR>) => void },
    ) => {
      const row = store.prs.find((p) => same(p, id));
      if (!row || isNewer(row.metaFetchedAt)) store.update(id, patch);
    };
    updateIfNewer(myPRs);
    updateIfNewer(mineAddedPRs);
    updateIfNewer(teamPRs);
    updateIfNewer(oncallPRs);
    updateIfNewer(minePRs);

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
  }, [myPRs, mineAddedPRs, teamPRs, oncallPRs, minePRs]);

  const setPendingReview = useCallback((id: Identity, reviewId: string | null) => {
    setPendingReviews((cur) => {
      const next = { ...cur };
      if (reviewId == null) delete next[prKey(id)];
      else next[prKey(id)] = reviewId;
      return next;
    });
  }, []);

  /** Fire the server-side conflict-resolution flow and patch list state.
   * Used by both the row's ConflictBadge click and the drawer footer's
   * "Try again" button. Returns nothing — UI reads state via
   * conflictResolutions.stateFor. */
  const resolveConflicts = useCallback(async (id: Identity) => {
    const repoPath = APP_CONFIG.localRepos?.[id.repo];
    if (!repoPath) {
      addToast('error', `Configure localRepos["${id.repo}"] in config.local.ts to auto-resolve conflicts`);
      return;
    }
    if (!conflictResolutions.start(id)) return; // concurrent click; already running
    const prRef = `${id.owner}/${id.repo}#${id.number}`;
    try {
      const result = await api.resolveConflicts(id.owner, id.repo, id.number, { repoPath });
      conflictResolutions.finishOk(id, result.commitSha);
      addToast('success', `Resolved conflicts on ${prRef} — pushed ${result.commitSha.slice(0, 8)}`);
      // Refresh the PR's meta so hasConflicts flips false on the row + drawer.
      try {
        const fresh = await api.getPullRequest(id.owner, id.repo, id.number, { fresh: true });
        handleMetaLoaded(id, fresh);
        // GitHub eventual consistency — re-fetch in 2s in case the push
        // hasn't propagated yet.
        setTimeout(async () => {
          try {
            const f2 = await api.getPullRequest(id.owner, id.repo, id.number, { fresh: true });
            handleMetaLoaded(id, f2);
          } catch { /* row will catch up on next auto-refresh */ }
        }, 2000);
      } catch { /* meta refetch is best-effort; the success state is already shown */ }
    } catch (e) {
      const err = e as ApiCallError;
      const code = (err as ApiCallError & { code?: string }).code;
      // Server may return a structured body for known errors (files list, etc.)
      // — surface the message verbatim so the user can copy/paste filenames.
      conflictResolutions.finishErr(id, err.message ?? String(e), code);
      addToast('error', `Conflict resolution failed for ${prRef}: ${err.message ?? 'unknown error'}`);
    }
  }, [addToast, conflictResolutions, handleMetaLoaded]);

  /** Fire the server-side fix-CI flow and patch list state on success. The
   * server installs deps + runs Claude in a worktree with broader tools
   * (Bash/Edit/Write/Grep/Glob/LS) and a long timeout. */
  const fixCi = useCallback(async (id: Identity) => {
    const repoPath = APP_CONFIG.localRepos?.[id.repo];
    if (!repoPath) {
      addToast('error', `Configure localRepos["${id.repo}"] in config.local.ts to fix CI`);
      return;
    }
    if (!ciFixes.start(id)) return;
    const prRef = `${id.owner}/${id.repo}#${id.number}`;
    try {
      const result = await api.fixCi(id.owner, id.repo, id.number, { repoPath });
      if ('noFailures' in result && result.noFailures) {
        ciFixes.finishNoFailures(id);
        addToast('info', `${prRef} has no failing CI checks — nothing for Claude to fix`);
        return;
      }
      if ('noChanges' in result && result.noChanges) {
        ciFixes.finishNoChanges(id);
        addToast('info', `Claude inspected ${prRef}'s failing checks and made no changes`);
        return;
      }
      // The "ok: true" path with commit info.
      const ok = result as Extract<typeof result, { commitSha: string }>;
      ciFixes.finishOk(id, {
        commitSha: ok.commitSha,
        filesChanged: ok.filesChanged ?? [],
        failingChecksFixed: ok.failingChecksFixed ?? [],
      });
      addToast('success', `Pushed CI fix on ${prRef} — ${ok.commitSha.slice(0, 8)} (${(ok.filesChanged ?? []).length} file${(ok.filesChanged ?? []).length === 1 ? '' : 's'})`);
      // Refresh meta so the ciStatus + contexts update after CI re-runs.
      try {
        const fresh = await api.getPullRequest(id.owner, id.repo, id.number, { fresh: true });
        handleMetaLoaded(id, fresh);
      } catch { /* best-effort */ }
    } catch (e) {
      const err = e as ApiCallError;
      const code = (err as ApiCallError & { code?: string }).code;
      // Many of these errors (INSTALL_FAILED, PUSH_FAILED, …) carry the
      // actionable stderr in `payload.details` / `payload.stderr`. Fold it
      // into the persisted error so the user sees it in the drawer card
      // instead of only the high-level toast message.
      const detailsRaw = (err.payload && (err.payload.details || err.payload.stderr)) as unknown;
      const detailsText = Array.isArray(detailsRaw) ? detailsRaw.join('\n\n')
        : (typeof detailsRaw === 'string' && detailsRaw ? detailsRaw : '');
      const fullError = detailsText
        ? `${err.message ?? 'unknown error'}\n\n${detailsText}`
        : err.message ?? String(e);
      ciFixes.finishErr(id, fullError, code);
      addToast('error', `CI fix failed for ${prRef}: ${err.message ?? 'unknown error'}`);
    }
  }, [addToast, ciFixes, handleMetaLoaded]);

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
            mineAddedPRs.update(p, { title: meta.title, authorLogin: meta.authorLogin, ghStatus: computeGhStatus(meta), ciStatus: meta.ciStatus, ciUrl: meta.ciUrl, labels: meta.labels ?? [], createdAt: meta.createdAt, autoMergeEnabled: meta.autoMergeRequest != null, mergeQueueQueued: meta.mergeQueueEntry != null, hasConflicts: meta.mergeable === 'CONFLICTING', trunkInQueue: !!meta.trunkInQueue, metaFetchedAt: Date.now() });
          }
        }
      });
      await Promise.all([refreshAuthored, refreshPasted]);
    } else if (tab === 'team') {
      await teamPRs.fetch({ fresh: true });
    } else if (tab === 'local') {
      // Re-fetch meta for each local branch so its title + head SHA refresh.
      // The diff endpoint keys by head SHA so it'll naturally bust the cache.
      await Promise.allSettled(
        localPRs.prs.map(async (p) => {
          if (!p.localPath || !p.branch) return;
          try {
            const meta = await api.getLocalMeta(p.repo, p.localPath, p.branch);
            localPRs.update(p, { title: meta.title, authorLogin: meta.authorLogin, createdAt: meta.createdAt });
          } catch { /* leave stale title — UI still works */ }
        }),
      );
    } else {
      await oncallPRs.fetch({ fresh: true });
    }
    setRefreshing(false);
  }, [tab, myPRs, minePRs, mineAddedPRs, teamPRs, oncallPRs, localPRs, refreshing]);

  const untouchedCount = (list: TrackedPR[]) => list.filter((p) => p.status === 'untouched').length;

  return (
    <MentionsProvider value={teamPRs.members}>
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
          ...(localRepoNames.length > 0
            ? [{ id: 'local' as const, label: 'Local', badge: untouchedCount(localPRs.prs) || null }]
            : []),
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
          {/* Green-CI quick filter — hides PRs with failing/pending/missing CI.
              Counter shows how many of the currently member-filtered PRs would
              survive if the toggle were on. */}
          {teamPRs.members.length > 0 && (() => {
            const greenCount = (memberFilter ?? new Set(teamPRs.members)).size === 0
              ? 0
              : teamPRs.prs.filter((p) => p.authorLogin != null && (memberFilter ?? new Set(teamPRs.members)).has(p.authorLogin) && p.ciStatus === 'SUCCESS').length;
            return (
              <label className="team-green-ci-toggle">
                <input
                  type="checkbox"
                  checked={teamGreenCiOnly}
                  onChange={(e) => setTeamGreenCiOnly(e.target.checked)}
                />
                <span>Green CI only{greenCount > 0 ? ` (${greenCount})` : ''}</span>
              </label>
            );
          })()}
        </>
      )}

      {tab === 'local' && (
        <>
          <p className="tab-context">
            <span className="tab-context-freshness">
              Diff a local branch against your checkout's <code>main</code>. No comments / no review actions — just the diff viewer.
            </span>
          </p>
          <AddLocalBranchBar
            repos={localRepoNames}
            onAdd={async (repoName, branch) => {
              const path = APP_CONFIG.localRepos[repoName];
              if (!path) {
                addToast('error', `No path configured for "${repoName}"`);
                return;
              }
              try {
                const meta = await api.getLocalMeta(repoName, path, branch);
                localPRs.add({
                  owner: 'local',
                  repo: repoName,
                  number: meta.number,
                  title: meta.title,
                  authorLogin: meta.authorLogin,
                  ghStatus: null,
                  ciStatus: null,
                  ciUrl: null,
                  labels: [],
                  createdAt: meta.createdAt,
                  source: 'local',
                  branch,
                  localPath: path,
                });
              } catch (e) {
                addToast('error', `Failed to add local branch: ${(e as Error).message}`);
                throw e;
              }
            }}
          />
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
        claudeStateFor={claudeResponses.aggregateFor}
        // ConflictBadge becomes interactive when a click handler is wired —
        // we always pass these so any conflicting PR can be resolved from
        // the row, regardless of tab.
        conflictStateFor={(t) => conflictResolutions.stateFor(t)}
        onResolveConflicts={(t) => resolveConflicts({ ...t })}
        ciFixStateFor={(t) => ciFixes.stateFor(t)}
        // Only on the My PRs tab — those are PRs the viewer can typically merge.
        // Fire-and-forget toggle: optimistically flip the row, toast on failure.
        showCopyLink={tab === 'mine'}
        onToggleAutoMerge={tab === 'mine' ? (id) => {
          const target = activePRs.find((p) => p.owner === id.owner && p.repo === id.repo && p.number === id.number);
          const isTrunk = (APP_CONFIG.trunkMergeRepos ?? []).includes(id.repo);
          // Optimistic flip. If the PR is already approved when enabling, also
          // assume it'll land straight in the merge queue (amber state) — that's
          // what GitHub does in practice. After the API call succeeds we refetch
          // meta to confirm the actual state. For Trunk repos GitHub doesn't
          // surface the queue state, so we skip the refetch and let the
          // optimistic flag carry until the next auto-refresh.
          const nextEnabled = !id.currentlyEnabled;
          const isApproved = target?.ghStatus === 'approved';
          const optimisticPatch = nextEnabled
            ? { autoMergeEnabled: true, mergeQueueQueued: isApproved }
            : { autoMergeEnabled: false, mergeQueueQueued: false };
          const inMine = !!target && minePRs.prs.some((p) => same(p, id));
          const inAdded = !!target && mineAddedPRs.prs.some((p) => same(p, id));
          if (target && inMine) minePRs.update(target, optimisticPatch);
          if (target && inAdded) mineAddedPRs.update(target, optimisticPatch);
          const prRef = `${id.owner}/${id.repo}#${id.number}`;
          const apiCall = isTrunk
            ? api.trunkMerge(id.owner, id.repo, id.number, { action: id.currentlyEnabled ? 'cancel' : 'enable' })
            : (id.currentlyEnabled
              ? api.disableAutoMerge(id.owner, id.repo, id.number)
              : api.enableAutoMerge(id.owner, id.repo, id.number));
          apiCall
            .then(async () => {
              if (isTrunk) {
                addToast('success', id.currentlyEnabled
                  ? `Posted /trunk cancel on ${prRef}`
                  : `Posted /trunk merge on ${prRef} — Trunk will manage the queue from here`);
                return; // No GH state to refetch for Trunk repos.
              }
              addToast('success', id.currentlyEnabled ? `Cancelled merge-when-ready for ${prRef}` : `Merge when ready enabled for ${prRef}`);
              // Refetch the PR meta to replace the optimistic flags with the
              // authoritative ones. GitHub is eventually-consistent here, so we
              // do an immediate refetch and a delayed one (~2s) to catch the
              // merge-queue state once it lands.
              const sync = async () => {
                if (!target) return;
                try {
                  const meta = await api.getPullRequest(id.owner, id.repo, id.number, { fresh: true });
                  const truth = { autoMergeEnabled: meta.autoMergeRequest != null, mergeQueueQueued: meta.mergeQueueEntry != null };
                  if (inMine) minePRs.update(target, truth);
                  if (inAdded) mineAddedPRs.update(target, truth);
                } catch { /* keep the optimistic state — better than blanking */ }
              };
              sync();
              setTimeout(sync, 2000);
            })
            .catch((e) => {
              // Revert optimistic flip on failure (both fields).
              const revert = { autoMergeEnabled: id.currentlyEnabled, mergeQueueQueued: !!target?.mergeQueueQueued };
              if (target && inMine) minePRs.update(target, revert);
              if (target && inAdded) mineAddedPRs.update(target, revert);
              addToast('error', isTrunk
                ? `Failed to post Trunk comment for ${prRef}: ${(e as Error).message}`
                : `Failed to toggle merge-when-ready for ${prRef}: ${(e as Error).message}`);
            });
        } : undefined}
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
        const toIdentity = (p: TrackedPR): Identity => ({
          owner: p.owner,
          repo: p.repo,
          number: p.number,
          source: p.source,
          branch: p.branch,
          localPath: p.localPath,
        });
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
            claudeChat={claudeResponses.chatFor(current)}
            threadClaudeState={(threadId) => claudeResponses.threadFor(current, threadId)}
            onAskClaudeChat={(userMessage) => claudeResponses.askInChat(current, userMessage)}
            onClearClaudeChat={() => claudeResponses.dismissChat(current)}
            onAskThreadClaude={(threadId, draft, lineRange) => claudeResponses.askThread(current, threadId, draft, lineRange)}
            onDismissThreadClaude={(threadId) => claudeResponses.dismissThread(current, threadId)}
            localClaudeThreads={claudeResponses.localThreadsForPR(current)}
            onAskInlineClaudeForLine={(anchor, draft) => claudeResponses.askInLocalThread(current, anchor, draft)}
            onDismissLocalClaudeThread={(anchor) => claudeResponses.dismissLocalThread(current, anchor)}
            conflictResolution={conflictResolutions.stateFor(current)}
            onResolveConflicts={() => resolveConflicts(current)}
            onDismissConflictResolution={() => conflictResolutions.dismiss(current)}
            ciFix={ciFixes.stateFor(current)}
            onFixCi={() => fixCi(current)}
            onDismissCiFix={() => ciFixes.dismiss(current)}
          />
        );
      })()}
      <NotesFab />
      <IssuesFab />
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
    </MentionsProvider>
  );
}
