import { useState } from 'react';
import type { ReviewEvent } from '../types.js';
import { EmojiTextarea } from './EmojiTextarea.js';
import { GitMergeIcon, GitMergeQueueIcon, EyeIcon, EyeClosedIcon } from '@primer/octicons-react';

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
  /** Show the Approve button. Defaults to canSubmit but the drawer
   *  overrides this to false on PRs the viewer authored — GitHub
   *  disallows self-approval so the button is dead-weight noise. */
  canApprove?: boolean;
  canReviewed: boolean;
  canPrev: boolean;
  canNextPR: boolean;
  /** When set, footer shows this as a heading and submit buttons mean "submit pending review". */
  finishLabel?: string | null;
  /** When provided, a "Mark ready for review" button renders alongside the other actions. */
  onMarkReady?: () => Promise<void>;
  /** Entry point into the persistent AI chat panel above. Drains the summary
   * textarea into the chat as the first user turn (or follow-up). */
  onAskAI?: () => void;
  /** True while the chat has an in-flight ask — disables the button to avoid double-fires. */
  aiChatLoading?: boolean;
  /** When provided, the footer renders a "Merge when ready" toggle (GitHub
   * auto-merge). Only shown for PRs the viewer authored / can merge. */
  onToggleAutoMerge?: () => Promise<void>;
  /** Current auto-merge state for the toggle's label + style. */
  autoMergeEnabled?: boolean;
  /** True when the PR is actively in the repo's merge queue (a stricter state
   * than autoMergeEnabled). Flips the toggle to its amber 'Queued to merge' look. */
  mergeQueueQueued?: boolean;
  /** Whether review/Claude comments are currently visible in the drawer.
   * Toggled by the eye icon next to the nav arrows. */
  commentsVisible?: boolean;
  /** Flip `commentsVisible`. Optional — when omitted the toggle isn't rendered
   * (e.g. local-branch footer, which has no comments to hide). */
  onToggleComments?: () => void;
  /** Fire the "Fix failing CI" flow. Only rendered when provided AND there are
   * failing checks on the PR (gated by the parent). */
  onFixCi?: () => void;
  /** When true, the Fix CI button shows its loading state. */
  ciFixRunning?: boolean;
  /** Number of failing checks (drives the tooltip text). */
  failingCheckCount?: number;
  /** Fire the rebase-onto-base flow. Rendered when the parent has a
   *  local repo path configured (rebase runs against a checkout). */
  onRebase?: () => void;
  /** When true, the Rebase button shows its loading state. */
  rebaseRunning?: boolean;
  /** Close the PR on GitHub without merging. Footer renders a destructive-
   * styled button when provided; the parent gates with a confirm prompt. */
  onClosePR?: () => Promise<void>;
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
 * no review-publish surface (Approve / Comment / Mark ready), since there's
 * no GitHub PR to publish against. */
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

export function ReviewFooter({
  summary, onSummaryChange, onSubmit, onReviewed, onPrev, onNextPR,
  canSubmit, canApprove, canReviewed, canPrev, canNextPR, finishLabel, onMarkReady,
  onAskAI, aiChatLoading, onToggleAutoMerge, autoMergeEnabled, mergeQueueQueued,
  commentsVisible, onToggleComments,
  onFixCi, ciFixRunning, failingCheckCount,
  onRebase, rebaseRunning,
  onClosePR,
}: Props) {
  const [markingReady, setMarkingReady] = useState(false);
  const [togglingAutoMerge, setTogglingAutoMerge] = useState(false);
  const [closing, setClosing] = useState(false);
  const canAskAI = !!onAskAI && summary.trim().length > 0 && !aiChatLoading;
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
        {canApprove !== false && (
          <button type="button" className="btn-primary" disabled={!canSubmit} onClick={() => onSubmit('APPROVE')}>Approve</button>
        )}
        <button type="button" disabled={!canSubmit} onClick={() => onSubmit('COMMENT')}>Comment</button>
        {onAskAI && (
          <button
            type="button"
            className="btn-ask-ai"
            disabled={!canAskAI}
            onClick={onAskAI}
            title="Move your draft into the AI chat panel above and ask the AI — doesn't post to GitHub"
          >
            {aiChatLoading ? 'Asking…' : 'Ask AI'}
          </button>
        )}
        {onFixCi && (
          <button
            type="button"
            className="btn-fix-ci"
            disabled={!!ciFixRunning}
            onClick={onFixCi}
            title={`Spin up a worktree, install deps, and ask Claude to fix the ${failingCheckCount ?? ''} failing CI check${failingCheckCount === 1 ? '' : 's'} on this PR`}
          >
            {ciFixRunning ? 'Fixing CI…' : `Fix CI${failingCheckCount ? ` (${failingCheckCount})` : ''}`}
          </button>
        )}
        {onRebase && (
          <button
            type="button"
            className="btn-rebase"
            disabled={!!rebaseRunning}
            onClick={onRebase}
            title="Rebase this PR onto its base branch. Runs in a throwaway worktree; Claude resolves any conflict markers under the same strict guidance the merge-conflict flow uses. Force-pushes with lease when done."
          >
            {rebaseRunning ? 'Rebasing…' : 'Rebase'}
          </button>
        )}
        <button type="button" disabled={!canReviewed} onClick={onReviewed}>Reviewed</button>
        {onToggleAutoMerge && (() => {
          // Three visual states matching the row pill:
          //  - default: outlined green   (not enabled)
          //  - on:       filled green     (auto-merge enabled, not yet queued)
          //  - queued:   filled amber + queue icon (in the merge queue)
          const cls = mergeQueueQueued
            ? 'footer-auto-merge footer-auto-merge-queued'
            : autoMergeEnabled
              ? 'footer-auto-merge footer-auto-merge-on'
              : 'footer-auto-merge';
          const label = mergeQueueQueued
            ? 'Queued — click to cancel'
            : autoMergeEnabled
              ? 'Cancel merge when ready'
              : 'Merge when ready';
          const aria = mergeQueueQueued
            ? 'Cancel merge queue entry'
            : autoMergeEnabled
              ? 'Cancel merge when ready'
              : 'Enable merge when ready';
          return (
            <button
              type="button"
              className={`${cls} has-tooltip`}
              disabled={togglingAutoMerge}
              onClick={async () => {
                setTogglingAutoMerge(true);
                try { await onToggleAutoMerge(); }
                finally { setTogglingAutoMerge(false); }
              }}
              aria-label={aria}
              data-tooltip={label}
            >
              {mergeQueueQueued ? <GitMergeQueueIcon size={18} /> : <GitMergeIcon size={18} />}
            </button>
          );
        })()}
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
        {onClosePR && (
          <button
            type="button"
            className="footer-close-pr"
            disabled={closing}
            onClick={async () => {
              setClosing(true);
              try { await onClosePR(); }
              finally { setClosing(false); }
            }}
            title="Close this PR on GitHub without merging (you can reopen it later)"
          >
            {closing ? 'Closing…' : 'Close PR'}
          </button>
        )}
        <div className="review-footer-nav">
          {onToggleComments && (
            <button
              type="button"
              className={`review-footer-arrow has-tooltip${commentsVisible === false ? ' review-footer-arrow-active' : ''}`}
              onClick={onToggleComments}
              aria-label={commentsVisible === false ? 'Show all comments' : 'Hide all comments'}
              data-tooltip={commentsVisible === false ? 'Show all comments' : 'Hide all comments'}
            >
              {commentsVisible === false ? <EyeClosedIcon size={14} /> : <EyeIcon size={14} />}
            </button>
          )}
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
