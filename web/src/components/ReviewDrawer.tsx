import { useCallback, useEffect, useRef, useState } from 'react';
import { PRHeader } from './PRHeader.js';
import { PRDescription } from './PRDescription.js';
import { ReviewSummaryList } from './ReviewSummaryList.js';
import { ConversationsList } from './ConversationsList.js';
import { DiffViewer } from './DiffViewer.js';
import { ReviewFooter, LocalReviewFooter } from './ReviewFooter.js';
import { ErrorToast } from './ErrorToast.js';
import { usePRDetails } from '../hooks/usePRDetails.js';
import { useNextPRPrefetch } from '../hooks/useNextPRPrefetch.js';
import { api } from '../lib/api.js';
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
  const drawerRef = useRef<HTMLElement | null>(null);

  useNextPRPrefetch({ current, prs });

  // When the drawer's PR changes (after Approve / Reviewed / nav arrows), reset
  // the scroll position so the new diff opens at the top instead of inheriting
  // the previous PR's scroll.
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

  const markReady = useCallback(async () => {
    if (!current) return;
    const prRef = `${current.owner}/${current.repo}#${current.number}`;
    try {
      await api.markReadyForReview(current.owner, current.repo, current.number);
      onToast('success', `Marked ${prRef} ready for review`);
      reload();
    } catch (e) {
      onToast('error', `Failed to mark ${prRef} ready for review: ${(e as Error).message}`);
    }
  }, [current, onToast, reload]);

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
            <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">×</button>
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
          <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">×</button>
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
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">×</button>
        {loading && <span className="drawer-refresh-indicator" aria-label="Refreshing"><span className="loading-spinner" /></span>}
      {/* Local-branch entries have no GitHub server-of-record for reviews/comments,
          so all review-action surfaces (summary list, conversations, footer
          publish buttons, inline comment composer) are hidden. The diff itself
          + file list + nav stay because that's what the user actually wants. */}
      <PRHeader meta={meta} latestGhStatus={latestGhStatus} latestCiStatus={latestCiStatus} latestCiUrl={latestCiUrl} />
      {meta.source !== 'local' && <PRDescription bodyHtml={meta.bodyHtml} />}
      {meta.source !== 'local' && <ReviewSummaryList reviews={meta.reviews ?? []} />}
      {meta.source !== 'local' && <ConversationsList threads={meta.reviewThreads} onReply={reply} />}
      <DiffViewer
        diff={diff}
        threads={meta.source === 'local' ? [] : meta.reviewThreads}
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
        />
      )}
      {error && <ErrorToast message={error.message} onDismiss={() => { /* user can reload */ }} />}
      </aside>
    </>
  );
}
