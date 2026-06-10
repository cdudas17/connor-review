import { useMemo } from 'react';
import { renderMarkdown } from '../lib/markdown.js';

export interface ClaudeResponseState {
  loading: boolean;
  /** Claude's response body (markdown). Present once the request resolves. */
  body?: string;
  /** Error message when the request failed. */
  error?: string;
  /** True if the server warned the diff was truncated for the prompt. */
  truncatedDiff?: boolean;
  /** Epoch millis when this entry settled. Persisted, used by the sweeper to
   * drop entries older than ~30 days. Not set on `loading: true` entries (those
   * aren't persisted anyway). */
  savedAt?: number;
}

interface Props {
  /** When null, the card renders nothing. */
  state: ClaudeResponseState | null;
  /** Optional dismiss handler — when set, an "×" appears in the corner. */
  onDismiss?: () => void;
}

/** Inline card that shows Claude's response next to a comment composer.
 *
 * Rendered as plain pre-wrap text — Claude's output is markdown, but rendering
 * it would require pulling in a markdown lib + sanitizer. Plain text reads fine
 * for code-review feedback; can upgrade later if it becomes annoying. */
export function ClaudeResponseCard({ state, onDismiss }: Props) {
  // Memo: marked + DOMPurify is cheap but Claude responses can be a few KB;
  // re-running on every parent render adds up across multiple cards.
  const html = useMemo(() => (state?.body ? renderMarkdown(state.body) : ''), [state?.body]);
  if (!state) return null;
  return (
    <div className="claude-response-card" role="region" aria-label="Claude response">
      <div className="claude-response-header">
        <span className="claude-response-label">
          {state.loading ? 'Asking Claude…' : 'Claude says'}
        </span>
        {onDismiss && !state.loading && (
          <button type="button" className="claude-response-dismiss" onClick={onDismiss} aria-label="Dismiss Claude response">×</button>
        )}
      </div>
      {state.loading && (
        <div className="claude-response-loading">
          <span className="loading-spinner" aria-hidden="true" />
        </div>
      )}
      {state.error && (
        <p className="claude-response-error">{state.error}</p>
      )}
      {state.body && !state.error && (
        <div className="markdown-body claude-response-body" dangerouslySetInnerHTML={{ __html: html }} />
      )}
      {state.truncatedDiff && state.body && !state.error && (
        <p className="claude-response-note">Diff was truncated for the prompt; Claude saw only the first portion.</p>
      )}
    </div>
  );
}
