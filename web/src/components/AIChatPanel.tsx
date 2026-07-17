import { useMemo, useState } from 'react';
import type { AIChat } from '../hooks/useAIResponses.js';
import { renderMarkdown } from '../lib/markdown.js';
import { EmojiTextarea } from './EmojiTextarea.js';

interface Props {
  chat: AIChat | null;
  /** Append a user turn + fire the AI with full history. */
  onAsk: (userMessage: string) => void;
  /** Drop the whole chat for this PR. */
  onClear: () => void;
}

/** Pinned panel above the diff Conversations section: a multi-turn AI chat
 * scoped to the current PR. Each click of Send sends the entire chain so
 * the model has context. Persists across drawer close / PR navigation.
 *
 * Empty state is hidden — the panel only renders when there's at least one
 * turn (the first user turn is added by the footer's "Ask AI" button). */
export function AIChatPanel({ chat, onAsk, onClear }: Props) {
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
    <section className="ai-chat-panel" aria-label="AI chat">
      <header className="ai-chat-header">
        <h3>AI chat <span className="ai-chat-count">{chat.turns.length} turn{chat.turns.length === 1 ? '' : 's'}</span></h3>
        <button type="button" className="ai-chat-clear" onClick={onClear} title="Clear this AI conversation">Clear chat</button>
      </header>
      <ol className="ai-chat-turns">
        {chat.turns.map((t, i) => (
          <li key={i} className={`ai-chat-turn ai-chat-turn-${t.role}`}>
            <header className="ai-chat-turn-header">
              <strong>{t.role === 'user' ? 'You' : 'AI'}</strong>
            </header>
            {t.role === 'user' ? (
              <p className="ai-chat-turn-body ai-chat-turn-user-body">{t.body}</p>
            ) : t.loading ? (
              <div className="ai-chat-turn-loading">
                <span className="loading-spinner" aria-hidden="true" />
                <span>Asking…</span>
              </div>
            ) : t.error ? (
              <p className="ai-chat-turn-error">{t.error}</p>
            ) : (
              <>
                <div
                  className="markdown-body ai-chat-turn-body"
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(t.body) }}
                />
                {t.truncatedDiff && (
                  <p className="ai-chat-turn-note">Diff was truncated for this turn's prompt.</p>
                )}
              </>
            )}
          </li>
        ))}
      </ol>
      <div className="ai-chat-input">
        <EmojiTextarea
          aria-label="Reply to AI"
          placeholder="Follow up… (Enter to send · Shift+Enter for newline)"
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
        <div className="ai-chat-input-actions">
          <button
            type="button"
            className="btn-ask-ai"
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
