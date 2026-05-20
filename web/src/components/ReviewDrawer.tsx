import { useState } from 'react';
import { PRHeader } from './PRHeader.js';
import { DiffViewer } from './DiffViewer.js';
import { ReviewFooter } from './ReviewFooter.js';
import { DiscardDraftsModal } from './DiscardDraftsModal.js';
import { ErrorToast } from './ErrorToast.js';
import { usePRDetails } from '../hooks/usePRDetails.js';
import { useNextPRPrefetch } from '../hooks/useNextPRPrefetch.js';
import { api } from '../lib/api.js';
import type { PRStatus, ReviewDrafts, ReviewEvent, StagedInlineComment, StagedThreadReply, TrackedPR } from '../types.js';

interface Identity { owner: string; repo: string; number: number; }

interface Props {
  current: Identity | null;
  prs: TrackedPR[];
  drafts: ReviewDrafts;
  hasDrafts: boolean;
  onSummaryChange: (id: Identity, value: string) => void;
  onAddInlineComment: (id: Identity, c: StagedInlineComment) => void;
  onRemoveInlineComment: (id: Identity, idx: number) => void;
  onAddReply: (id: Identity, r: StagedThreadReply) => void;
  onClearDrafts: (id: Identity) => void;
  onAdvance: (id: Identity, newStatus: PRStatus) => void;
  onClose: () => void;
}

export function ReviewDrawer(props: Props) {
  const { current, prs, drafts, hasDrafts, onSummaryChange, onAddInlineComment, onRemoveInlineComment, onAddReply, onClearDrafts, onAdvance, onClose } = props;
  const { meta, diff, loading, error } = usePRDetails(current);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [askingDiscard, setAskingDiscard] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useNextPRPrefetch({ current, prs });

  if (!current) return null;
  if (loading || !meta || diff == null) return <aside className="drawer"><p>Loading...</p></aside>;

  const canSubmit = meta.state === 'OPEN' && !submitting;
  const canNext = !submitting;

  const submitReview = async (event: ReviewEvent) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.submitReview(current.owner, current.repo, current.number, {
        event,
        body: drafts.summary || undefined,
        comments: drafts.inlineComments.length ? drafts.inlineComments : undefined,
      });
      for (const r of drafts.replies) {
        await api.replyToThread(current.owner, current.repo, current.number, r.threadId, r.body);
      }
      onClearDrafts(current);
      onAdvance(current, event === 'APPROVE' ? 'approved' : 'reviewed');
    } catch (e) {
      setSubmitError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const doNext = () => {
    if (hasDrafts) { setAskingDiscard(true); return; }
    onAdvance(current, 'reviewed');
  };

  return (
    <aside className="drawer" aria-label="Review drawer">
      <button type="button" className="drawer-close" onClick={onClose} aria-label="Close drawer">×</button>
      <PRHeader meta={meta} />
      <DiffViewer
        diff={diff}
        threads={meta.reviewThreads}
        stagedComments={drafts.inlineComments}
        onAddInlineComment={(c) => onAddInlineComment(current, c)}
        onRemoveStagedComment={(idx) => onRemoveInlineComment(current, idx)}
        onReplyToThread={(threadId, body) => onAddReply(current, { threadId, body })}
      />
      <ReviewFooter
        summary={drafts.summary}
        onSummaryChange={(v) => onSummaryChange(current, v)}
        onSubmit={submitReview}
        onNext={doNext}
        canSubmit={canSubmit}
        canNext={canNext}
      />
      {error && <ErrorToast message={error.message} onDismiss={() => { /* user can reload */ }} />}
      {submitError && <ErrorToast message={submitError} onDismiss={() => setSubmitError(null)} />}
      <DiscardDraftsModal
        open={askingDiscard}
        onCancel={() => setAskingDiscard(false)}
        onDiscard={() => { setAskingDiscard(false); onClearDrafts(current); onAdvance(current, 'reviewed'); }}
      />
    </aside>
  );
}
