import { useMemo, useState } from 'react';
import type { ClaudeChat } from '../hooks/useClaudeResponses.js';
import { renderMarkdown } from '../lib/markdown.js';
import { EmojiTextarea } from './EmojiTextarea.js';

interface Props {
  chat: ClaudeChat | null;
  /** Append a user turn + fire Claude with full history. */
  onAsk: (userMessage: string) => void;
  /** Drop the whole chat for this PR. */
  onClear: () => void;
}

/** Pinned panel above the diff Conversations section: a multi-turn Claude chat
 * scoped to the current PR. Each click of Send sends the entire chain so
 * Claude has context. Persists across drawer close / PR navigation.
 *
 * Empty state is hidden — the panel only renders when there's at least one
 * turn (the first user turn is added by the footer's "Ask Claude" button). */
export function ClaudeChatPanel({ chat, onAsk, onClear }: Props) {
  const [draft, setDraft] = useState('');
  const isLoading = useMemo(() => chat?.turns.some((t) => t.loading) ?? false, [chat]);
  if (!chat || chat.turns.length === 0) return null;
  const canSend = !isLoading && draft.trim().length > 0;
  const submit = () => {
    if (!canSend) return;
    onAsk(draft);
    setDraft('');
  };
  return (
    <section className="claude-chat-panel" aria-label="Claude chat">
      <header className="claude-chat-header">
        <h3>Claude chat <span className="claude-chat-count">{chat.turns.length} turn{chat.turns.length === 1 ? '' : 's'}</span></h3>
        <button type="button" className="claude-chat-clear" onClick={onClear} title="Clear this Claude conversation">Clear chat</button>
      </header>
      <ol className="claude-chat-turns">
        {chat.turns.map((t, i) => (
          <li key={i} className={`claude-chat-turn claude-chat-turn-${t.role}`}>
            <header className="claude-chat-turn-header">
              <strong>{t.role === 'user' ? 'You' : 'Claude'}</strong>
            </header>
            {t.role === 'user' ? (
              <p className="claude-chat-turn-body claude-chat-turn-user-body">{t.body}</p>
            ) : t.loading ? (
              <div className="claude-chat-turn-loading">
                <span className="loading-spinner" aria-hidden="true" />
                <span>Asking Claude…</span>
              </div>
            ) : t.error ? (
              <p className="claude-chat-turn-error">{t.error}</p>
            ) : (
              <>
                <div
                  className="markdown-body claude-chat-turn-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(t.body) }}
                />
                {t.truncatedDiff && (
                  <p className="claude-chat-turn-note">Diff was truncated for this turn's prompt.</p>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="claude-chat-input">
        <EmojiTextarea
          aria-label="Reply to Claude"
          placeholder="Follow up with Claude… (Enter to send · Shift+Enter for newline)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter submits; Shift+Enter inserts a newline (default).
            // EmojiTextarea consumes Enter when its suggestion popup is open
            // so emoji shortcode autocomplete still works first.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          disabled={isLoading}
        />
        <div className="claude-chat-input-actions">
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
    </section>
  );
}
