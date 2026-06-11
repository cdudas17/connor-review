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
import { maybeAutoLabelOnReview } from '../lib/autoLabel.js';
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
}

export function ReviewDrawer(props: Props) {
  const {
    current, prs, pendingReviewId, latestGhStatus, latestCiStatus, latestCiUrl, viewedPaths,
    onViewedChange, onPendingReviewChange, onMetaLoaded, onAdvance, onNavigatePrev, onNavigateNext,
    canNavigatePrev, canNavigateNext, onToast, onSetStatus, onClose,
    claudeChat, threadClaudeState, onAskClaudeChat, onClearClaudeChat,
    onAskThreadClaude, onDismissThreadClaude,
    localClaudeThreads, onAskInlineClaudeForLine, onDismissLocalClaudeThread,
  } = props;
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
    // Visible-feedback event → run auto-label rules. Best-effort, never throws.
    void maybeAutoLabelOnReview(current, meta?.authorLogin, { onToast });
    reload();
  }, [current, reload, meta?.authorLogin, onToast]);

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
    // Visible-feedback event → run auto-label rules.
    void maybeAutoLabelOnReview(current, meta?.authorLogin, { onToast });
    reload();
  }, [current, reload, meta?.authorLogin, onToast]);

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
      <PRHeader meta={meta} latestGhStatus={latestGhStatus} latestCiStatus={latestCiStatus} latestCiUrl={latestCiUrl} />
      {meta.source !== 'local' && <PRDescription bodyHtml={meta.bodyHtml} />}
      {meta.source !== 'local' && <ReviewSummaryList reviews={meta.reviews ?? []} />}
      {meta.source !== 'local' && (
        <ClaudeChatPanel
          chat={claudeChat}
          onAsk={onAskClaudeChat}
          onClear={onClearClaudeChat}
        />
      )}
      {meta.source !== 'local' && (
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
        // Inline composer Ask Claude: persisted local-only thread anchored to the line range.
        onAskInlineClaude={meta.source === 'local' ? undefined : onAskInlineClaudeForLine}
        localClaudeThreads={meta.source === 'local' ? [] : localClaudeThreads}
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
