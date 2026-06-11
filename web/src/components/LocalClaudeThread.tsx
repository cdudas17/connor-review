import { useState } from 'react';
import type { ClaudeChat, LocalThreadAnchor } from '../hooks/useClaudeResponses.js';
import { renderMarkdown } from '../lib/markdown.js';
import { EmojiTextarea } from './EmojiTextarea.js';

interface Props {
  chat: ClaudeChat;
  anchor: LocalThreadAnchor;
  onAsk: (userMessage: string) => void;
  onDismiss: () => void;
}

/** Inline Claude conversation anchored to a specific diff line range. Looks
 * similar to a regular GitHub thread card (so it visually slots into the diff)
 * but with a distinct accent stripe + 'CLAUDE' label so it's clear nothing here
 * is being sent to GitHub. Multi-turn: every Send appends and re-asks with the
 * prior history. */
export function LocalClaudeThread({ chat, anchor, onAsk, onDismiss }: Props) {
  const [draft, setDraft] = useState('');
  const isLoading = chat.turns.some((t) => t.loading);
  const canSend = !isLoading && draft.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    onAsk(draft);
    setDraft('');
  };
  // File path is dropped — the thread is already visually anchored to the
  // line in the diff above. Just show line(s) + side for orientation.
  const rangeLabel = anchor.startLine != null && anchor.startLine !== anchor.line
    ? `Lines ${anchor.startLine}–${anchor.line} (${anchor.side})`
    : `Line ${anchor.line} (${anchor.side})`;
  return (
    <article className="local-claude-thread" aria-label="Claude inline thread">
      <header className="local-claude-thread-header">
        <span className="local-claude-thread-label">Claude · local only</span>
        <span className="local-claude-thread-anchor">{rangeLabel}</span>
        <button
          type="button"
          className="local-claude-thread-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss this Claude thread"
          title="Dismiss this Claude thread"
        >×</button>
      </header>
      <ol className="local-claude-thread-turns">
        {chat.turns.map((t, i) => (
          <li key={i} className={`local-claude-thread-turn local-claude-thread-turn-${t.role}`}>
            <header className="local-claude-thread-turn-header">
              <strong>{t.role === 'user' ? 'You' : 'Claude'}</strong>
            </header>
            {t.role === 'user' ? (
              <p className="local-claude-thread-turn-body local-claude-thread-turn-user-body">{t.body}</p>
            ) : t.loading ? (
              <div className="local-claude-thread-turn-loading">
                <span className="loading-spinner" aria-hidden="true" />
                <span>Asking Claude…</span>
              </div>
            ) : t.error ? (
              <p className="local-claude-thread-turn-error">{t.error}</p>
            ) : (
              <>
                <div
                  className="markdown-body local-claude-thread-turn-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(t.body) }}
                />
                {t.truncatedDiff && (
                  <p className="local-claude-thread-turn-note">Diff was truncated for this turn's prompt.</p>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="local-claude-thread-input">
        <EmojiTextarea
          aria-label="Follow up with Claude on this line"
          placeholder="Follow up with Claude… (Enter to send · Shift+Enter for newline)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={isLoading}
        />
        <div className="local-claude-thread-input-actions">
          <button
            type="button"
            className="btn-ask-claude"
            disabled={!canSend}
            onClick={submit}
          >
            {isLoading ? 'Asking…' : 'Send'}
          </button>
        </div>
      </div>
    </article>
  );
}
