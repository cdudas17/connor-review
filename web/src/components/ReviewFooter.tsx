import { useState } from 'react';
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
  /** When provided, a "Mark ready for review" button renders alongside the other actions. */
  onMarkReady?: () => Promise<void>;
  /** Entry point into the persistent Claude chat panel above. Drains the summary
   * textarea into the chat as the first user turn (or follow-up). */
  onAskClaude?: () => void;
  /** True while the chat has an in-flight ask — disables the button to avoid double-fires. */
  claudeChatLoading?: boolean;
  /** When provided, the footer renders a "Merge when ready" toggle (GitHub
   * auto-merge). Only shown for PRs the viewer authored / can merge. */
  onToggleAutoMerge?: () => Promise<void>;
  /** Current auto-merge state for the toggle's label + style. */
  autoMergeEnabled?: boolean;
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

/** Stripped-down footer for local-branch entries: just "Reviewed" + prev/next nav,
 * no review-publish surface (Approve / Comment / Request changes / Mark ready), since
 * there's no GitHub PR to publish against. */
export function LocalReviewFooter({
  onReviewed, onPrev, onNextPR, canReviewed, canPrev, canNextPR,
}: {
  onReviewed: () => void;
  onPrev: () => void;
  onNextPR: () => void;
  canReviewed: boolean;
  canPrev: boolean;
  canNextPR: boolean;
}) {
  return (
    <footer className="review-footer">
      <div className="review-footer-actions">
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

function GitMergeIcon({ size = 14 }: { size?: number }) {
  // Octicons "git-merge".
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M5 3.254V3.25v.005a.75.75 0 1 1 0-.005ZM5 5.5V3.5a3.5 3.5 0 0 1 5.487-2.87l2.07-2.07a.75.75 0 1 1 1.06 1.06l-2.07 2.07A3.5 3.5 0 0 1 9 8.732V11.5a3.25 3.25 0 1 1-1.5 0V8.732A3.5 3.5 0 0 1 5 5.5ZM5.5 14.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm0-13a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>
    </svg>
  );
}

export function ReviewFooter({
  summary, onSummaryChange, onSubmit, onReviewed, onPrev, onNextPR,
  canSubmit, canReviewed, canPrev, canNextPR, finishLabel, onMarkReady,
  onAskClaude, claudeChatLoading, onToggleAutoMerge, autoMergeEnabled,
}: Props) {
  const [markingReady, setMarkingReady] = useState(false);
  const [togglingAutoMerge, setTogglingAutoMerge] = useState(false);
  const canAskClaude = !!onAskClaude && summary.trim().length > 0 && !claudeChatLoading;
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
        {onAskClaude && (
          <button
            type="button"
            className="btn-ask-claude"
            disabled={!canAskClaude}
            onClick={onAskClaude}
            title="Move your draft into the Claude chat panel above and ask Claude — doesn't post to GitHub"
          >
            {claudeChatLoading ? 'Asking…' : 'Ask Claude'}
          </button>
        )}
        <button type="button" disabled={!canReviewed} onClick={onReviewed}>Reviewed</button>
        {onToggleAutoMerge && (
          <button
            type="button"
            className={`footer-auto-merge${autoMergeEnabled ? ' footer-auto-merge-on' : ''}`}
            disabled={togglingAutoMerge}
            onClick={async () => {
              setTogglingAutoMerge(true);
              try { await onToggleAutoMerge(); }
              finally { setTogglingAutoMerge(false); }
            }}
            title={autoMergeEnabled
              ? "Cancel 'merge when ready' (auto-merge will no longer happen)"
              : "Enable 'merge when ready' (auto-merge once checks pass + approvals land)"}
          >
            <GitMergeIcon />
            <span>{togglingAutoMerge ? '…' : autoMergeEnabled ? 'Cancel merge when ready' : 'Merge when ready'}</span>
          </button>
        )}
        {onMarkReady && (
          <button
            type="button"
            className="footer-mark-ready"
            disabled={markingReady}
            onClick={async () => {
              setMarkingReady(true);
              try { await onMarkReady(); }
              finally { setMarkingReady(false); }
            }}
            title="Flip this draft PR to ready for review"
          >
            {markingReady ? 'Marking…' : 'Mark ready for review'}
          </button>
        )}
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
