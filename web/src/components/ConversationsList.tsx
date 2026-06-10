import { useState } from 'react';
import type { ReviewThread } from '../types.js';
import { DiffHunkSnippet } from './DiffHunkSnippet.js';
import { EmojiTextarea } from './EmojiTextarea.js';
import { Avatar } from './Avatar.js';
import { ClaudeResponseCard, type ClaudeResponseState } from './ClaudeResponseCard.js';

interface Props {
  threads: ReviewThread[];
  onReply: (threadId: string, body: string) => Promise<void>;
  /** Per-thread Claude state lookup. State is owned at App level and persisted across drawer close. */
  claudeStateFor?: (threadId: string) => ClaudeResponseState | null;
  /** Ask Claude for a specific thread. Fires the App-level handler that may toast on late arrival. */
  onAskClaude?: (threadId: string, draft: string, lineRange: { path: string; startLine?: number; endLine: number; side: 'LEFT' | 'RIGHT' }) => void;
  /** Dismiss the per-thread Claude card. */
  onDismissClaude?: (threadId: string) => void;
}

function formatTimeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return 'just now';
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString();
}

interface CardProps {
  thread: ReviewThread;
  onReply: (threadId: string, body: string) => Promise<void>;
  claudeState: ClaudeResponseState | null;
  onAskClaude?: Props['onAskClaude'];
  onDismissClaude?: Props['onDismissClaude'];
}

function ConversationCard({ thread, onReply, claudeState, onAskClaude, onDismissClaude }: CardProps) {
  const [open, setOpen] = useState(true);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askClaude = () => {
    if (!onAskClaude || reply.trim() === '') return;
    onAskClaude(thread.id, reply.trim(), {
      path: thread.path,
      endLine: thread.line ?? 0,
      startLine: thread.startLine ?? undefined,
      side: thread.diffSide ?? 'RIGHT',
    });
  };

  const first = thread.comments[0];

  async function submit() {
    if (reply.trim() === '') return;
    setReplying(true);
    setError(null);
    try {
      await onReply(thread.id, reply);
      setReply('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReplying(false);
    }
  }

  return (
    <article className={`conversation-card${open ? '' : ' conversation-card-collapsed'}`}>
      <button type="button" className="conversation-card-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
        {!open && <code className="conversation-card-path">{thread.path}:{thread.line}</code>}
        <span className="conversation-card-summary">
          {first?.authorLogin ?? '?'} · {thread.comments.length} comment{thread.comments.length === 1 ? '' : 's'}
          {first ? ` · ${formatTimeAgo(first.createdAt)}` : ''}
        </span>
        {thread.isOutdated && <span className="thread-outdated-badge" title="The line this comment was made on has changed in a later commit">Outdated</span>}
      </button>
      {open && (
        <div className="conversation-card-body">
          <DiffHunkSnippet hunk={first?.diffHunk ?? null} path={thread.path} />
          {thread.comments.map((c) => (
            <div key={c.id} className="conversation-message">
              <header className="conversation-message-header">
                <Avatar url={c.authorAvatarUrl} login={c.authorLogin} />
                <strong>{c.authorLogin ?? '?'}</strong>
                <time>{formatTimeAgo(c.createdAt)}</time>
              </header>
              {c.bodyHtml
                ? <div className="markdown-body conversation-message-body" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} />
                : <p>{c.body}</p>}
            </div>
          ))}
          <div className="conversation-reply">
            <EmojiTextarea
              placeholder="Reply…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              disabled={replying}
            />
            {error && <p className="conversation-reply-error">{error}</p>}
            <ClaudeResponseCard
              state={claudeState}
              onDismiss={onDismissClaude ? () => onDismissClaude(thread.id) : undefined}
            />
            <div className="conversation-reply-actions">
              <button type="button" className="btn-primary" disabled={replying || reply.trim() === ''} onClick={submit}>
                {replying ? 'Replying…' : 'Reply'}
              </button>
              {onAskClaude && (
                <button
                  type="button"
                  className="btn-ask-claude"
                  disabled={reply.trim() === '' || claudeState?.loading}
                  onClick={askClaude}
                  title="Send your draft reply + this thread's line range to your local `claude` CLI"
                >
                  {claudeState?.loading ? 'Asking…' : 'Ask Claude'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </article>
  );
}

export function ConversationsList({ threads, onReply, claudeStateFor, onAskClaude, onDismissClaude }: Props) {
  const [sectionOpen, setSectionOpen] = useState(true);
  const active = threads.filter((t) => !t.isResolved);
  if (active.length === 0) return null;
  return (
    <section className="conversations">
      <header className="conversations-header">
        <button type="button" className="conversations-toggle" onClick={() => setSectionOpen((o) => !o)} aria-expanded={sectionOpen}>
          <span className="caret" aria-hidden="true">{sectionOpen ? '▾' : '▸'}</span>
          <h3>Conversations <span className="conversations-count">{active.length}</span></h3>
        </button>
      </header>
      {sectionOpen && (
        <div className="conversations-list">
          {active.map((t) => (
            <ConversationCard
              key={t.id}
              thread={t}
              onReply={onReply}
              claudeState={claudeStateFor?.(t.id) ?? null}
              onAskClaude={onAskClaude}
              onDismissClaude={onDismissClaude}
            />
          ))}
        </div>
      )}
    </section>
  );
}
