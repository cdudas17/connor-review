import { useCallback, useEffect, useState } from 'react';
import { PRHeader } from './PRHeader.js';
import { PRDescription } from './PRDescription.js';
import { ConversationsList } from './ConversationsList.js';
import { DiffViewer } from './DiffViewer.js';
import { ReviewFooter } from './ReviewFooter.js';
import { ErrorToast } from './ErrorToast.js';
import { usePRDetails } from '../hooks/usePRDetails.js';
import { useNextPRPrefetch } from '../hooks/useNextPRPrefetch.js';
import { api } from '../lib/api.js';
import type { CiStatus, GhStatus, PRStatus, PullRequestMeta, ReviewEvent, StagedInlineComment, TrackedPR } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }

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
}

export function ReviewDrawer(props: Props) {
  const { current, prs, pendingReviewId, latestGhStatus, latestCiStatus, latestCiUrl, viewedPaths, onViewedChange, onPendingReviewChange, onMetaLoaded, onAdvance, onNavigatePrev, onNavigateNext, canNavigatePrev, canNavigateNext, onToast, onSetStatus, onClose } = props;
  const { meta, diff, loading, error, reload } = usePRDetails(current);
  const [summary, setSummary] = useState('');

  useNextPRPrefetch({ current, prs });

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
    reload();
  }, [current, reload]);

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
    reload();
  }, [current, pendingReviewId, onPendingReviewChange, reload]);

  const reply = useCallback(async (threadId: string, body: string) => {
    if (!current) return;
    await api.replyToThread(current.owner, current.repo, current.number, threadId, body);
    reload();
  }, [current, reload]);

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
  // Only show the "Loading…" placeholder on the very first fetch (no data yet).
  // On reloads after posting a comment/reply, keep the previous meta + diff rendered
  // so the user's scroll position and thought process aren't interrupted; the new
  // thread will pop in once the fetch resolves.
  if (!meta || diff == null) {
    return (
      <>
        <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
        <aside className="drawer"><p>Loading…</p></aside>
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

    const verb = event === 'APPROVE' ? 'Approved' : event === 'REQUEST_CHANGES' ? 'Requested changes on' : 'Commented on';
    const prRef = `${target.owner}/${target.repo}#${target.number}`;

    (async () => {
      try {
        if (reviewIdForSubmit) {
          await api.submitPendingReview(target.owner, target.repo, target.number, reviewIdForSubmit, { event, body });
        } else {
          await api.createReview(target.owner, target.repo, target.number, { event, body });
        }
        onToast('success', `${verb} ${prRef}`);
      } catch (e) {
        // Revert the local status so the PR stays in the queue for retry.
        onSetStatus(target, 'untouched');
        // If we cleared a pending review id optimistically, restore it.
        if (reviewIdForSubmit) onPendingReviewChange(target, reviewIdForSubmit);
        onToast('error', `Failed to ${verb.toLowerCase()} ${prRef}: ${(e as Error).message}`);
      }
    })();
  };

  const doNext = () => onAdvance(current, 'reviewed');

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" aria-label="Review drawer">
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">×</button>
        {loading && <span className="drawer-refresh-indicator" aria-label="Refreshing"><span className="loading-spinner" /></span>}
      <PRHeader meta={meta} latestGhStatus={latestGhStatus} latestCiStatus={latestCiStatus} latestCiUrl={latestCiUrl} />
      <PRDescription bodyHtml={meta.bodyHtml} />
      <ConversationsList threads={meta.reviewThreads} onReply={reply} />
      <DiffViewer
        diff={diff}
        threads={meta.reviewThreads}
        hasPendingReview={pendingReviewId != null}
        pr={{ owner: current.owner, repo: current.repo, number: current.number, baseRef: meta.baseRefName }}
        viewedPaths={viewedPaths}
        onViewedChange={onViewedChange}
        onCommitComment={commitStandaloneComment}
        onAddToReview={addToReview}
        onReply={reply}
      />
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
      />
      {error && <ErrorToast message={error.message} onDismiss={() => { /* user can reload */ }} />}
      </aside>
    </>
  );
}
