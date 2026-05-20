import type { ReviewEvent } from '../types.js';

interface Props {
  summary: string;
  onSummaryChange: (value: string) => void;
  onSubmit: (event: ReviewEvent) => void;
  onNext: () => void;
  canSubmit: boolean;
  canNext: boolean;
}

export function ReviewFooter({ summary, onSummaryChange, onSubmit, onNext, canSubmit, canNext }: Props) {
  return (
    <footer className="review-footer">
      <textarea
        aria-label="Review summary"
        placeholder="Leave a summary (optional)"
        value={summary}
        onChange={(e) => onSummaryChange(e.target.value)}
      />
      <div className="review-footer-actions">
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('APPROVE')}>Approve</button>
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('REQUEST_CHANGES')}>Request changes</button>
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('COMMENT')}>Comment</button>
        <button type="button" disabled={!canNext} onClick={onNext}>Next</button>
      </div>
    </footer>
  );
}
