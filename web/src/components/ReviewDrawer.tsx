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
  onPendingReviewChange: (id: Identity, reviewId: string | null) => void;
  onMetaLoaded?: (id: Identity, meta: PullRequestMeta) => void;
  onAdvance: (id: Identity, newStatus: PRStatus) => void;
  onClose: () => void;
}

export function ReviewDrawer(props: Props) {
  const { current, prs, pendingReviewId, latestGhStatus, latestCiStatus, onPendingReviewChange, onMetaLoaded, onAdvance, onClose } = props;
  const { meta, diff, loading, error, reload } = usePRDetails(current);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
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
  if (loading || !meta || diff == null) {
    return (
      <>
        <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
        <aside className="drawer"><p>Loading…</p></aside>
      </>
    );
  }

  const canSubmit = meta.state === 'OPEN' && !submitting;
  const canNext = !submitting;

  const submitReview = async (event: ReviewEvent) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      if (pendingReviewId) {
        await api.submitPendingReview(current.owner, current.repo, current.number, pendingReviewId, {
          event,
          body: summary || undefined,
        });
        onPendingReviewChange(current, null);
      } else {
        await api.createReview(current.owner, current.repo, current.number, {
          event,
          body: summary || undefined,
        });
      }
      setSummary('');
      onAdvance(current, event === 'APPROVE' ? 'approved' : 'reviewed');
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const doNext = () => onAdvance(current, 'reviewed');

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" aria-label="Review drawer">
        <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">×</button>
      <PRHeader meta={meta} latestGhStatus={latestGhStatus} latestCiStatus={latestCiStatus} />
      <PRDescription bodyHtml={meta.bodyHtml} />
      <ConversationsList threads={meta.reviewThreads} onReply={reply} />
      <DiffViewer
        diff={diff}
        threads={meta.reviewThreads}
        hasPendingReview={pendingReviewId != null}
        pr={{ owner: current.owner, repo: current.repo, number: current.number, baseRef: meta.baseRefName }}
        onCommitComment={commitStandaloneComment}
        onAddToReview={addToReview}
        onReply={reply}
      />
      <ReviewFooter
        summary={summary}
        onSummaryChange={setSummary}
        onSubmit={submitReview}
        onNext={doNext}
        canSubmit={canSubmit}
        canNext={canNext}
        finishLabel={pendingReviewId ? 'Finish your review' : null}
      />
      {error && <ErrorToast message={error.message} onDismiss={() => { /* user can reload */ }} />}
      {submitError && <ErrorToast message={submitError} onDismiss={() => setSubmitError(null)} />}
      </aside>
    </>
  );
}
