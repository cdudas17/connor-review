import { useState } from 'react';
import type { CiStatus, GhStatus, PullRequestMeta } from '../types.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { CiBadge } from './CiBadge.js';
import { ConflictBadge } from './ConflictBadge.js';
import { LabelChips } from './LabelChips.js';
import { AssigneesRow } from './AssigneesRow.js';
import { computeGhStatus } from '../lib/ghStatus.js';

interface Props {
  meta: PullRequestMeta;
  /** Latest values from the auto-refreshing list. Override the (potentially stale)
   *  values derived from the drawer's own meta fetch. */
  latestGhStatus?: GhStatus | null;
  latestCiStatus?: CiStatus;
  latestCiUrl?: string | null;
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

export function PRHeader({ meta, latestGhStatus, latestCiStatus, latestCiUrl }: Props) {
  const status = latestGhStatus ?? computeGhStatus(meta);
  const ci = latestCiStatus !== undefined ? latestCiStatus : meta.ciStatus;
  const ciUrl = latestCiUrl !== undefined ? latestCiUrl : meta.ciUrl;
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(meta.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be unavailable (e.g. insecure context). Silently noop.
    }
  };

  return (
    <header className="pr-header">
      <div className="pr-header-title">
        <h2>{meta.title}</h2>
        <ConflictBadge hasConflicts={meta.mergeable === 'CONFLICTING'} variant="header" />
        <GhStatusBadge status={status} />
        <CiBadge status={ci} url={ciUrl} />
      </div>
      <LabelChips labels={meta.labels ?? []} />
      <AssigneesRow assignees={meta.assignees ?? []} />
      <p className="pr-header-meta">
        <a href={meta.url} target="_blank" rel="noopener noreferrer">#{meta.number}</a>
        <button
          type="button"
          className={`pr-link-copy${copied ? ' pr-link-copy-copied' : ''}`}
          onClick={onCopy}
          aria-label="Copy PR link"
          title={copied ? 'Copied!' : 'Copy PR link'}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
        {' · '}
        {meta.authorLogin ?? 'unknown'}
        {' · '}
        <code>{meta.headRefName}</code> → <code>{meta.baseRefName}</code>
      </p>
    </header>
  );
}
