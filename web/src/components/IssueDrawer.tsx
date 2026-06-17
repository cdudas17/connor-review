import { useEffect, useRef } from 'react';
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

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, onClose]);

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
