import type { ReviewEvent } from '../types.js';
import { EmojiTextarea } from './EmojiTextarea.js';

interface Props {
  summary: string;
  onSummaryChange: (value: string) => void;
  onSubmit: (event: ReviewEvent) => void;
  /** Marks the current PR as `reviewed` and advances to the next untouched PR. */
  onReviewed: () => void;
  /** Move to the previous PR in the list without changing status. */
  onPrev: () => void;
  /** Move to the next PR in the list without changing status. */
  onNextPR: () => void;
  canSubmit: boolean;
  canReviewed: boolean;
  canPrev: boolean;
  canNextPR: boolean;
  /** When set, footer shows this as a heading and submit buttons mean "submit pending review". */
  finishLabel?: string | null;
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 1 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06z"/>
    </svg>
  );
}
function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 1 1-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06z"/>
    </svg>
  );
}

export function ReviewFooter({
  summary, onSummaryChange, onSubmit, onReviewed, onPrev, onNextPR,
  canSubmit, canReviewed, canPrev, canNextPR, finishLabel,
}: Props) {
  return (
    <footer className="review-footer">
      {finishLabel && <h4 className="review-footer-heading">{finishLabel}</h4>}
      <EmojiTextarea
        aria-label="Review summary"
        placeholder="Leave a summary (optional)"
        value={summary}
        onChange={(e) => onSummaryChange(e.target.value)}
      />
      <div className="review-footer-actions">
        <button type="button" className="btn-primary" disabled={!canSubmit} onClick={() => onSubmit('APPROVE')}>Approve</button>
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('REQUEST_CHANGES')}>Request changes</button>
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('COMMENT')}>Comment</button>
        <button type="button" disabled={!canReviewed} onClick={onReviewed}>Reviewed</button>
        <div className="review-footer-nav">
          <button type="button" className="review-footer-arrow" disabled={!canPrev} onClick={onPrev} aria-label="Previous PR" title="Previous PR">
            <ChevronLeftIcon />
          </button>
          <button type="button" className="review-footer-arrow" disabled={!canNextPR} onClick={onNextPR} aria-label="Next PR" title="Next PR">
            <ChevronRightIcon />
          </button>
        </div>
      </div>
    </footer>
  );
}
