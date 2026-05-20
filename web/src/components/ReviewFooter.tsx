import type { ReviewEvent } from '../types.js';

interface Props {
  summary: string;
  onSummaryChange: (value: string) => void;
  onSubmit: (event: ReviewEvent) => void;
  onNext: () => void;
  canSubmit: boolean;
  canNext: boolean;
  /** When set, footer shows this as a heading and submit buttons mean "submit pending review". */
  finishLabel?: string | null;
}

export function ReviewFooter({ summary, onSummaryChange, onSubmit, onNext, canSubmit, canNext, finishLabel }: Props) {
  return (
    <footer className="review-footer">
      {finishLabel && <h4 className="review-footer-heading">{finishLabel}</h4>}
      <textarea
        aria-label="Review summary"
        placeholder="Leave a summary (optional)"
        value={summary}
        onChange={(e) => onSummaryChange(e.target.value)}
      />
      <div className="review-footer-actions">
        <button type="button" className="btn-primary" disabled={!canSubmit} onClick={() => onSubmit('APPROVE')}>Approve</button>
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('REQUEST_CHANGES')}>Request changes</button>
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('COMMENT')}>Comment</button>
        <button type="button" disabled={!canNext} onClick={onNext}>Next</button>
      </div>
    </footer>
  );
}
