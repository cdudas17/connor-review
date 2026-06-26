import { useEffect, useRef, useState } from 'react';
import { useIssueDetails, type IssueId } from '../hooks/useIssueDetails.js';
import { LabelChips } from './LabelChips.js';
import { AssigneesRow } from './AssigneesRow.js';

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
    </svg>
  );
}
function CopyIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/>
      <path fill="currentColor" d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/>
    </svg>
  );
}
function CheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 .018-1.042.751.751 0 0 1 1.042-.018L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/>
    </svg>
  );
}

function RefreshIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
    </svg>
  );
}

function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

interface Props {
  current: IssueId | null;
  onClose: () => void;
}

/** Lightweight drawer that mirrors the PR-drawer chrome (.drawer +
 * .drawer-backdrop) but shows just an issue's title, rendered body, and
 * metadata. No diff, no review actions, no inline editing — issues don't
 * have those surfaces. A "View on GitHub" link covers everything we don't
 * inline here. */
export function IssueDrawer({ current, onClose }: Props) {
  const { issue, loading, error, reload } = useIssueDetails(current);
  const drawerRef = useRef<HTMLElement | null>(null);
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    if (!issue?.url) return;
    try {
      await navigator.clipboard.writeText(issue.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context). Silently noop.
    }
  };

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, onClose]);

  // Reset the copy-success flag when the open issue changes so a stale
  // green check doesn't carry over to the next issue.
  useEffect(() => { setCopied(false); }, [current?.owner, current?.repo, current?.number]);

  // Reset scroll when the open issue changes.
  useEffect(() => {
    if (drawerRef.current) drawerRef.current.scrollTop = 0;
  }, [current?.owner, current?.repo, current?.number]);

  if (!current) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer issue-drawer" ref={drawerRef} aria-label={`Issue ${current.owner}/${current.repo}#${current.number}`}>
        <button type="button" className="drawer-close has-tooltip" data-tooltip="Close (Esc)" aria-label="Close drawer" onClick={onClose}>
          <CloseIcon size={18} />
        </button>
        <button
          type="button"
          className="drawer-refresh"
          onClick={() => reload()}
          disabled={loading}
          aria-label="Refresh issue"
          title="Refresh issue"
        >
          {loading ? (
            <span className="loading-spinner drawer-refresh-spinner" aria-hidden="true" />
          ) : (
            <RefreshIcon size={18} />
          )}
        </button>
        {loading && !issue && (
          <div className="drawer-loading">
            <span className="loading-spinner drawer-loading-spinner" aria-hidden="true" />
            <span className="drawer-loading-label">Loading {current.owner}/{current.repo}#{current.number}…</span>
          </div>
        )}
        {error && !issue && (
          <div className="drawer-error">
            <h3>Couldn't load this issue</h3>
            <p className="drawer-error-message">{error.message}</p>
            <div className="drawer-error-actions">
              <a href={`https://github.com/${current.owner}/${current.repo}/issues/${current.number}`} target="_blank" rel="noopener noreferrer">View on GitHub</a>
              <button type="button" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
        {issue && (
          <>
            <header className="pr-header">
              <div className="pr-header-title">
                <h2>{issue.title}</h2>
                <span className={`issue-state-badge issue-state-${issue.state}`}>{issue.state === 'open' ? 'Open' : 'Closed'}</span>
              </div>
              <LabelChips labels={issue.labels} />
              <AssigneesRow assignees={issue.assignees} />
              <p className="pr-header-meta">
                <a href={issue.url} target="_blank" rel="noopener noreferrer">#{issue.number}</a>
                <button
                  type="button"
                  className={`pr-link-copy${copied ? ' pr-link-copy-copied' : ''}`}
                  onClick={onCopy}
                  aria-label="Copy issue link"
                  title={copied ? 'Copied!' : 'Copy issue link'}
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
                {' · '}
                {issue.authorLogin ?? 'unknown'}
                {' · opened '}{formatDate(issue.createdAt)}
                {' · updated '}{formatDate(issue.updatedAt)}
              </p>
            </header>
            {issue.bodyHtml
              ? <div className="markdown-body issue-body" dangerouslySetInnerHTML={{ __html: issue.bodyHtml }} />
              : <p className="issue-body-empty">No description provided.</p>}
          </>
        )}
      </aside>
    </>
  );
}
