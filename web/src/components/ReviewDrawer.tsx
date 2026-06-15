import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PRHeader } from './PRHeader.js';
import { PRDescription } from './PRDescription.js';
import { ReviewSummaryList } from './ReviewSummaryList.js';
import { ConversationsList } from './ConversationsList.js';
import { DiffViewer } from './DiffViewer.js';
import { ReviewFooter, LocalReviewFooter } from './ReviewFooter.js';
import { ErrorToast } from './ErrorToast.js';
import { ConflictResolutionCard } from './ConflictResolutionCard.js';
import { usePRDetails } from '../hooks/usePRDetails.js';
import { computeDiffStats } from '../lib/diffStats.js';
import { useNextPRPrefetch } from '../hooks/useNextPRPrefetch.js';
import { api } from '../lib/api.js';
import { maybeAutoLabelOnReview } from '../lib/autoLabel.js';
import { APP_CONFIG } from '../config.js';
import type { ClaudeResponseState } from './ClaudeResponseCard.js';
import type { ClaudeChat, LocalThreadAnchor } from '../hooks/useClaudeResponses.js';
import { ClaudeChatPanel } from './ClaudeChatPanel.js';
import type { CiStatus, GhStatus, PRStatus, PullRequestMeta, ReviewEvent, StagedInlineComment, TrackedPR } from '../types.js';

interface Identity {
  owner: string;
  repo: string;
  number: number;
  /** Discriminator for non-GitHub entries; defaults to 'github' when omitted. */
  source?: 'github' | 'local';
  /** For local entries: branch name. */
  branch?: string;
  /** For local entries: absolute path to the git checkout. */
  localPath?: string;
  /** For local entries: config short-name (matches AppConfig.localRepos key). */
  localRepo?: string;
}

const noopAsync = async (_c: StagedInlineComment): Promise<void> => { /* local entries can't post inline comments */ };
const noopReply = async (_threadId: string, _body: string): Promise<void> => { /* local entries have no threads */ };

/** Global drawer preference: show vs. hide all review + Claude comments.
 * Persisted as a single boolean (`'1'` / `'0'`) — applies to every PR until
 * the user flips it again. */
const COMMENTS_VISIBLE_STORAGE_KEY = 'connor-review.commentsVisible.v1';

/** Material-design "refresh" icon. Defined inline using the EXACT same JSX
 * shape as CopyIcon / ChevronRightIcon in this codebase (numeric size prop,
 * 24×24 viewBox, single filled path) so it renders at the same fidelity. */
function RefreshIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
    </svg>
  );
}

/** Close "×" icon — Material/Heroicons-style stroked X. Symmetric within the
 * 24×24 viewBox so it centers cleanly inside the button (unlike the unicode
 * × character which sits visually low because of its baseline). */
function CloseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
    </svg>
  );
}

interface Props {
  current: Identity | null;
  prs: TrackedPR[];
  pendingReviewId: string | null;
  /** Latest CI / GH status from the auto-refreshing list — overrides drawer-fetched meta. */
  latestGhStatus?: GhStatus | null;
  latestCiStatus?: CiStatus;
  latestCiUrl?: string | null;
  viewedPaths: Set<string>;
  onViewedChange: (path: string, viewed: boolean) => void;
  onPendingReviewChange: (id: Identity, reviewId: string | null) => void;
  onMetaLoaded?: (id: Identity, meta: PullRequestMeta) => void;
  onAdvance: (id: Identity, newStatus: PRStatus) => void;
  /** Move drawer to the previous PR in the list without changing status. */
  onNavigatePrev: () => void;
  /** Move drawer to the next PR in the list without changing status. */
  onNavigateNext: () => void;
  canNavigatePrev: boolean;
  canNavigateNext: boolean;
  /** Fire a toast notification (success/error/info). */
  onToast: (kind: 'success' | 'error' | 'info', message: string) => void;
  /** Reset a PR's local status — used to revert when a fire-and-forget API call fails. */
  onSetStatus: (id: Identity, status: PRStatus) => void;
  onClose: () => void;
  /** Persistent Claude chat for this PR. Owned at App level. */
  claudeChat: ClaudeChat | null;
  /** Look up thread-reply Claude state by thread id. */
  threadClaudeState: (threadId: string) => ClaudeResponseState | null;
  /** Append a user turn + fire Claude with the full chat history. Drawer
   * passes either the summary-textarea draft (first turn) or the chat panel's
   * own input (follow-ups). */
  onAskClaudeChat: (userMessage: string) => void;
  /** Drop the whole chat for this PR. */
  onClearClaudeChat: () => void;
  /** Fire an ask against a thread reply. */
  onAskThreadClaude: (threadId: string, draft: string, lineRange: { path: string; startLine?: number; endLine: number; side: 'LEFT' | 'RIGHT' }) => void;
  onDismissThreadClaude: (threadId: string) => void;
  /** Persisted inline Claude threads anchored on the diff for this PR. */
  localClaudeThreads: Array<ClaudeChat & { anchor: LocalThreadAnchor; key: string }>;
  /** Start or continue a local Claude thread at the given line anchor. */
  onAskInlineClaudeForLine: (anchor: LocalThreadAnchor, draft: string) => void;
  /** Dismiss a local Claude thread (× on the card). */
  onDismissLocalClaudeThread: (anchor: LocalThreadAnchor) => void;
  /** Current conflict-resolution entry for this PR (null when there's none). */
  conflictResolution: import('../hooks/useConflictResolutions.js').ConflictResolutionEntry | null;
  /** Fire / re-fire the resolve flow for the open PR. */
  onResolveConflicts: () => void;
  /** Clear the stored conflict-resolution entry (× on the card). */
  onDismissConflictResolution: () => void;
}

export function ReviewDrawer(props: Props) {
  const {
    current, prs, pendingReviewId, latestGhStatus, latestCiStatus, latestCiUrl, viewedPaths,
    onViewedChange, onPendingReviewChange, onMetaLoaded, onAdvance, onNavigatePrev, onNavigateNext,
    canNavigatePrev, canNavigateNext, onToast, onSetStatus, onClose,
    claudeChat, threadClaudeState, onAskClaudeChat, onClearClaudeChat,
    onAskThreadClaude, onDismissThreadClaude,
    localClaudeThreads, onAskInlineClaudeForLine, onDismissLocalClaudeThread,
    conflictResolution, onResolveConflicts, onDismissConflictResolution,
  } = props;
  const { meta, diff, loading, error, reload } = usePRDetails(current);
  // GitHub-style +N -M totals for the PR header. Memoised on diff identity
  // because computeDiffStats is a linear scan over the raw diff string.
  const diffStats = useMemo(() => computeDiffStats(diff), [diff]);
  const [summary, setSummary] = useState('');
  // Show / hide all review + Claude comments in the drawer. Global preference
  // — flipping it in any PR carries through to every other PR and survives
  // page reloads via localStorage.
  const [commentsVisible, setCommentsVisible] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(COMMENTS_VISIBLE_STORAGE_KEY);
      // Default to visible when no preference is stored.
      return raw == null ? true : raw === '1';
    } catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem(COMMENTS_VISIBLE_STORAGE_KEY, commentsVisible ? '1' : '0'); }
    catch { /* quota / non-browser env — preference falls back to in-memory only */ }
  }, [commentsVisible]);
  const drawerRef = useRef<HTMLElement | null>(null);

  /** Fire `reload()` now, then again ~2s later. GitHub's GraphQL has
   * read-after-write eventual consistency — sometimes the just-created review
   * thread isn't in the next meta fetch even though the mutation succeeded.
   * The second pass catches that case so the user doesn't have to manually
   * click refresh. The fetch already passes `fresh: true` so the server cache
   * is bypassed. */
  const reloadWithCatchup = useCallback(() => {
    reload();
    const t = setTimeout(() => reload(), 2000);
    return () => clearTimeout(t);
  }, [reload]);

  useNextPRPrefetch({ current, prs });

  // When the drawer's PR changes (after Approve / Reviewed / nav arrows), reset
  // the scroll position so the new diff opens at the top instead of inheriting
  // the previous PR's scroll. The comments-visible toggle is intentionally NOT
  // reset here — it's a global preference (see COMMENTS_VISIBLE_STORAGE_KEY).
  useEffect(() => {
    if (drawerRef.current) drawerRef.current.scrollTop = 0;
  }, [current?.owner, current?.repo, current?.number]);

  // Reset summary draft when switching PRs.
  // (Per-PR persistence of summary across drawer close/reopen is intentional and lives in App.)

  const commitStandaloneComment = useCallback(async (c: StagedInlineComment) => {
    if (!current) return;
    // GitHub's data model attaches every inline comment to a review. To match what the
    // github.com "Comment" button does, submit a one-shot review with event=COMMENT
    // containing only this thread — published immediately, no pending review involved.
    await api.createReview(current.owner, current.repo, current.number, {
      event: 'COMMENT',
      threads: [c],
    });
    // Visible-feedback event → run auto-label rules. Best-effort, never throws.
    void maybeAutoLabelOnReview(current, meta?.authorLogin, { onToast });
    reloadWithCatchup();
  }, [current, reloadWithCatchup, meta?.authorLogin, onToast]);

  const addToReview = useCallback(async (c: StagedInlineComment) => {
    if (!current) return;
    if (pendingReviewId) {
      await api.createThread(current.owner, current.repo, current.number, { ...c, pullRequestReviewId: pendingReviewId });
    } else {
      const review = await api.createReview(current.owner, current.repo, current.number, {
        event: 'PENDING',
        threads: [c],
      });
      onPendingReviewChange(current, review.id);
    }
    reloadWithCatchup();
  }, [current, pendingReviewId, onPendingReviewChange, reloadWithCatchup]);

  const reply = useCallback(async (threadId: string, body: string) => {
    if (!current) return;
    await api.replyToThread(current.owner, current.repo, current.number, threadId, body);
    // Visible-feedback event → run auto-label rules.
    void maybeAutoLabelOnReview(current, meta?.authorLogin, { onToast });
    reloadWithCatchup();
  }, [current, reloadWithCatchup, meta?.authorLogin, onToast]);

  const markReady = useCallback(async () => {
    if (!current) return;
    const prRef = `${current.owner}/${current.repo}#${current.number}`;
    try {
      await api.markReadyForReview(current.owner, current.repo, current.number);
      // Apply the configured label transitions for this workflow event. Both
      // operations are best-effort — a label failure shouldn't undo the
      // draft→ready flip (which has no easy revert anyway).
      const addLabels = APP_CONFIG.markReadyAddLabels ?? [];
      const removeLabels = APP_CONFIG.markReadyRemoveLabels ?? [];
      const labelOps: Array<Promise<unknown>> = [];
      if (addLabels.length > 0) {
        labelOps.push(api.addLabels(current.owner, current.repo, current.number, addLabels, { mode: 'add' }));
      }
      for (const name of removeLabels) {
        labelOps.push(api.removeLabel(current.owner, current.repo, current.number, name));
      }
      if (labelOps.length > 0) {
        const results = await Promise.allSettled(labelOps);
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length > 0) {
          onToast('info', `Marked ${prRef} ready, but ${failed.length} label change(s) failed — see console.`);
          // eslint-disable-next-line no-console
          for (const r of failed) console.warn('markReady label op failed:', r);
        } else {
          onToast('success', `Marked ${prRef} ready for review`);
        }
      } else {
        onToast('success', `Marked ${prRef} ready for review`);
      }
      reloadWithCatchup();
    } catch (e) {
      onToast('error', `Failed to mark ${prRef} ready for review: ${(e as Error).message}`);
    }
  }, [current, onToast, reloadWithCatchup]);

  // Optimistic override for the merge-when-ready footer button. When the user
  // clicks the toggle we flip the visual immediately (and assume an approved PR
  // will land in the merge queue), then `reloadWithCatchup` re-fetches meta and
  // the override clears once the fresh truth is in. `null` = no override, defer
  // to whatever the latest meta says.
  const [optimisticAutoMerge, setOptimisticAutoMerge] = useState<{ autoMergeEnabled: boolean; mergeQueueQueued: boolean } | null>(null);

  const toggleAutoMerge = useCallback(async () => {
    if (!current || !meta) return;
    const prRef = `${current.owner}/${current.repo}#${current.number}`;
    const isTrunk = (APP_CONFIG.trunkMergeRepos ?? []).includes(current.repo);
    // For Trunk repos the truth source is the Trunk CI check via
    // `meta.trunkInQueue`. Fall through to the optimistic flag if it's set
    // (handles the brief window between a click and Trunk's check appearing).
    const enabled = isTrunk
      ? (optimisticAutoMerge?.autoMergeEnabled ?? !!meta.trunkInQueue)
      : !!meta.autoMergeRequest;
    const isApproved = (meta.reviewDecision ?? null) === 'APPROVED';
    // Optimistic flip: enabling an approved PR → assume the queue picks it up.
    setOptimisticAutoMerge(enabled
      ? { autoMergeEnabled: false, mergeQueueQueued: false }
      : { autoMergeEnabled: true, mergeQueueQueued: isApproved });
    try {
      if (isTrunk) {
        await api.trunkMerge(current.owner, current.repo, current.number, {
          action: enabled ? 'cancel' : 'enable',
        });
        onToast('success', enabled
          ? `Posted /trunk cancel on ${prRef}`
          : `Posted /trunk merge on ${prRef} — Trunk will manage the queue from here`);
        // Skip reloadWithCatchup: GitHub doesn't reflect Trunk state, so the
        // refetch would just clear our optimistic flag.
        return;
      }
      if (enabled) {
        await api.disableAutoMerge(current.owner, current.repo, current.number);
        onToast('success', `Cancelled merge-when-ready for ${prRef}`);
      } else {
        await api.enableAutoMerge(current.owner, current.repo, current.number);
        onToast('success', `Merge when ready enabled for ${prRef}`);
      }
      reloadWithCatchup();
    } catch (e) {
      // Revert the optimistic visual; surface the failure.
      setOptimisticAutoMerge(null);
      onToast('error', isTrunk
        ? `Failed to post Trunk comment for ${prRef}: ${(e as Error).message}`
        : `Failed to toggle merge when ready for ${prRef}: ${(e as Error).message}`);
    }
  }, [current, meta, onToast, reloadWithCatchup, optimisticAutoMerge]);

  // Clear the optimistic override once a fresh meta arrives whose state agrees
  // with what we optimistically flipped to — or after ~3s as a hard fallback
  // for the eventual-consistency case where GitHub hasn't reflected the queue
  // entry yet but our amber state is the truth on the wire.
  //
  // For Trunk-managed repos the truth source is `meta.trunkInQueue` (a CI
  // check), not `meta.autoMergeRequest`. The optimistic state clears as soon
  // as the Trunk check appears / disappears to match what the user clicked.
  useEffect(() => {
    if (!optimisticAutoMerge || !meta || !current) return;
    const isTrunk = (APP_CONFIG.trunkMergeRepos ?? []).includes(current.repo);
    const truthEnabled = isTrunk ? !!meta.trunkInQueue : (meta.autoMergeRequest != null);
    if (truthEnabled === optimisticAutoMerge.autoMergeEnabled) {
      setOptimisticAutoMerge(null);
      return;
    }
    // For Trunk we wait longer (15s) because the queue check can take a beat
    // to register after `/trunk merge` is posted. For GitHub auto-merge the
    // existing 3s was fine.
    const t = setTimeout(() => setOptimisticAutoMerge(null), isTrunk ? 15000 : 3000);
    return () => clearTimeout(t);
  }, [meta?.autoMergeRequest, meta?.mergeQueueEntry, meta?.trunkInQueue, optimisticAutoMerge, current]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, onClose]);

  // Push fresh meta back to the App so the PR row's ghStatus stays in sync.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (current && meta && onMetaLoaded) onMetaLoaded(current, meta);
  }, [current?.owner, current?.repo, current?.number, meta?.headSha]);

  if (!current) return null;
  // First-fetch states. On reloads of an already-loaded PR (posting a comment etc.)
  // we keep the previous meta + diff rendered so the user's scroll/thought process
  // isn't interrupted.
  //
  // If a first fetch fails (e.g. branch removed locally, server can't read the path),
  // surface the error here — otherwise the drawer would sit on "Loading…" forever.
  if (!meta || diff == null) {
    if (error) {
      return (
        <>
          <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
          <aside className="drawer">
            <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">
          <CloseIcon size={18} />
        </button>
            <div className="drawer-error">
              <h3>Couldn't load this PR</h3>
              <p className="drawer-error-message">{error.message}</p>
              <div className="drawer-error-actions">
                <button type="button" onClick={reload}>Retry</button>
                <button type="button" onClick={onClose}>Close</button>
              </div>
            </div>
          </aside>
        </>
      );
    }
    return (
      <>
        <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
        <aside className="drawer">
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">
          <CloseIcon size={18} />
        </button>
          <div className="drawer-loading" role="status" aria-live="polite">
            <span className="loading-spinner drawer-loading-spinner" aria-hidden="true" />
            <span className="drawer-loading-label">Loading diff…</span>
          </div>
        </aside>
      </>
    );
  }

  const canSubmit = meta.state === 'OPEN';
  const canNext = true;

  const submitReview = (event: ReviewEvent) => {
    // Snapshot the data we need, then advance immediately so the user moves to
    // the next PR without waiting on the network. The API call runs in the
    // background and toasts success/failure.
    const target: Identity = { owner: current.owner, repo: current.repo, number: current.number };
    const body = summary || undefined;
    const reviewIdForSubmit = pendingReviewId;
    const newStatus: PRStatus = event === 'APPROVE' ? 'approved' : 'reviewed';

    setSummary('');
    if (reviewIdForSubmit) onPendingReviewChange(target, null);
    onAdvance(target, newStatus);

    const pastTenseVerb = event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Requested changes on' : 'Commented on';
    // Base-form verb for the "Failed to ..." error path. Lowercasing the past-tense
    // verb produces "Failed to commented on" which is ungrammatical.
    const baseVerb = event === 'APPROVE' ? 'approve' : event === 'REQUEST_CHANGES' ? 'request changes on' : 'comment on';
    const prRef = `${target.owner}/${target.repo}#${target.number}`;

    (async () => {
      try {
        if (reviewIdForSubmit) {
          await api.submitPendingReview(target.owner, target.repo, target.number, reviewIdForSubmit, { event, body });
        } else {
          await api.createReview(target.owner, target.repo, target.number, { event, body });
        }
        onToast('success', `${pastTenseVerb} ${prRef}`);
        // Auto-label rules fire on actual feedback events only. APPROVE is not
        // "comments left" — it's the opposite — so we skip the rule there. The
        // standalone-comment + thread-reply paths above always trigger, since
        // those are always real comments.
        if (event !== 'APPROVE') {
          void maybeAutoLabelOnReview(target, meta.authorLogin, { onToast });
        }
      } catch (e) {
        // Revert the local status so the PR stays in the queue for retry.
        onSetStatus(target, 'untouched');
        // If we cleared a pending review id optimistically, restore it.
        if (reviewIdForSubmit) onPendingReviewChange(target, reviewIdForSubmit);
        onToast('error', `Failed to ${baseVerb} ${prRef}: ${(e as Error).message}`);
      }
    })();
  };

  const doNext = () => onAdvance(current, 'reviewed');

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" aria-label="Review drawer" ref={drawerRef}>
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">
          <CloseIcon size={18} />
        </button>
        <button
          type="button"
          className="drawer-refresh"
          onClick={() => reload()}
          disabled={loading}
          aria-label="Refresh this PR's diff + threads"
          title="Refresh this PR's diff + threads"
        >
          {loading ? (
            <span className="loading-spinner drawer-refresh-spinner" aria-hidden="true" />
          ) : (
            <RefreshIcon size={18} />
          )}
        </button>
      {/* Local-branch entries have no GitHub server-of-record for reviews/comments,
          so all review-action surfaces (summary list, conversations, footer
          publish buttons, inline comment composer) are hidden. The diff itself
          + file list + nav stay because that's what the user actually wants. */}
      <PRHeader
        meta={meta}
        latestGhStatus={latestGhStatus}
        latestCiStatus={latestCiStatus}
        latestCiUrl={latestCiUrl}
        conflictState={conflictResolution?.kind === 'running' ? 'running'
          : conflictResolution?.kind === 'failed' ? 'failed'
          : 'idle'}
        onResolveConflicts={meta.source === 'local' ? undefined : onResolveConflicts}
        diffStats={diffStats}
      />
      {meta.source !== 'local' && <PRDescription bodyHtml={meta.bodyHtml} />}
      {meta.source !== 'local' && <ReviewSummaryList reviews={meta.reviews ?? []} />}
      {meta.source !== 'local' && (
        <ClaudeChatPanel
          chat={claudeChat}
          onAsk={onAskClaudeChat}
          onClear={onClearClaudeChat}
        />
      )}
      {meta.source !== 'local' && conflictResolution && (
        <ConflictResolutionCard
          entry={conflictResolution}
          onRetry={onResolveConflicts}
          onDismiss={onDismissConflictResolution}
        />
      )}
      {meta.source !== 'local' && commentsVisible && (
        <ConversationsList
          threads={meta.reviewThreads}
          onReply={reply}
          claudeStateFor={threadClaudeState}
          onAskClaude={onAskThreadClaude}
          onDismissClaude={onDismissThreadClaude}
        />
      )}
      <DiffViewer
        diff={diff}
        threads={(meta.source === 'local' || !commentsVisible) ? [] : meta.reviewThreads}
        hasPendingReview={meta.source !== 'local' && pendingReviewId != null}
        pr={{
          owner: current.owner,
          repo: current.repo,
          number: current.number,
          baseRef: meta.baseRefName,
          source: meta.source ?? 'github',
          localPath: current.localPath,
        }}
        viewedPaths={viewedPaths}
        onViewedChange={onViewedChange}
        onCommitComment={meta.source === 'local' ? noopAsync : commitStandaloneComment}
        onAddToReview={meta.source === 'local' ? noopAsync : addToReview}
        onReply={meta.source === 'local' ? noopReply : reply}
        commentsEnabled={meta.source !== 'local'}
        // Inline composer Ask Claude: persisted local-only thread anchored to the line range.
        onAskInlineClaude={meta.source === 'local' ? undefined : onAskInlineClaudeForLine}
        localClaudeThreads={(meta.source === 'local' || !commentsVisible) ? [] : localClaudeThreads}
        onAskLocalThread={meta.source === 'local' ? undefined : onAskInlineClaudeForLine}
        onDismissLocalThread={meta.source === 'local' ? undefined : onDismissLocalClaudeThread}
        // InlineThreadCard Ask Claude: persisted at App level. Drawer hands the threadId + draft to the parent.
        threadClaudeStateFor={threadClaudeState}
        onAskThreadClaude={onAskThreadClaude}
        onDismissThreadClaude={onDismissThreadClaude}
      />
      {meta.source === 'local' ? (
        <LocalReviewFooter
          onReviewed={doNext}
          onPrev={onNavigatePrev}
          onNextPR={onNavigateNext}
          canReviewed={canNext}
          canPrev={canNavigatePrev && canNext}
          canNextPR={canNavigateNext && canNext}
        />
      ) : (
        <ReviewFooter
          summary={summary}
          onSummaryChange={setSummary}
          onSubmit={submitReview}
          onReviewed={doNext}
          onPrev={onNavigatePrev}
          onNextPR={onNavigateNext}
          canSubmit={canSubmit}
          canReviewed={canNext}
          canPrev={canNavigatePrev && canNext}
          canNextPR={canNavigateNext && canNext}
          finishLabel={pendingReviewId ? 'Finish your review' : null}
          onMarkReady={meta.isDraft ? markReady : undefined}
          // Show the auto-merge toggle when GitHub says the viewer can use it
          // OR when auto-merge is already enabled (so they can cancel it).
          // The viewer ≈ the configured myPRsAuthor for normal users; we use
          // GitHub's own viewerCanEnableAutoMerge so we don't have to track
          // permission ourselves.
          onToggleAutoMerge={(
            (meta.viewerCanEnableAutoMerge || !!meta.autoMergeRequest || !!meta.mergeQueueEntry || (APP_CONFIG.trunkMergeRepos ?? []).includes(current.repo))
            && meta.state === 'OPEN' && !meta.merged
          ) ? toggleAutoMerge : undefined}
          autoMergeEnabled={optimisticAutoMerge?.autoMergeEnabled ?? (!!meta.autoMergeRequest || !!meta.trunkInQueue)}
          mergeQueueQueued={optimisticAutoMerge?.mergeQueueQueued ?? (!!meta.mergeQueueEntry || !!meta.trunkInQueue)}
          commentsVisible={commentsVisible}
          onToggleComments={() => setCommentsVisible((v) => !v)}
          onAskClaude={() => {
            // Drain the summary textarea into the chat as the next user turn,
            // then clear it so the box is free for an actual review summary.
            const draft = summary.trim();
            if (!draft) return;
            onAskClaudeChat(draft);
            setSummary('');
          }}
          claudeChatLoading={claudeChat?.turns.some((t) => t.loading) ?? false}
        />
      )}
      {error && <ErrorToast message={error.message} onDismiss={() => { /* user can reload */ }} />}
      </aside>
    </>
  );
}
