import { useState } from 'react';
import type { TrackedPR } from '../types.js';
import { StatusBadge } from './StatusBadge.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { CiBadge } from './CiBadge.js';
import { ClaudeBadge } from './ClaudeBadge.js';
import { LabelChips } from './LabelChips.js';
import type { FilterMode } from './FilterToggle.js';
import { GitMergeIcon, GitMergeQueueIcon, CopyIcon, CheckIcon } from '@primer/octicons-react';

interface Identity {
  owner: string;
  repo: string;
  number: number;
  source?: 'github' | 'local';
  branch?: string;
  localPath?: string;
}
function prKey(id: Identity) { return `${id.owner}/${id.repo}#${id.number}`; }

function formatOpenedAt(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const y = d.getFullYear();
  return `${m}/${day}/${y}`;
}

interface Props {
  prs: TrackedPR[];
  mode: FilterMode;
  onOpen: (id: Identity) => void;
  /** When set, a checkbox is rendered on each row; clicks on the checkbox don't open the drawer. */
  selection?: {
    selectedKeys: Set<string>;
    onToggle: (id: Identity) => void;
    /** Optional predicate — when false for a row, no checkbox renders on that row. */
    isSelectable?: (id: Identity) => boolean;
  };
  /** Per-PR Claude state aggregator (summary + threads). When provided, each row
   * renders a small badge indicating in-progress / saved-response / failed. */
  claudeStateFor?: (id: { owner: string; repo: string; number: number }) => { kind: 'loading' | 'error' | 'success' } | null;
  /** When set, each row renders a "Merge when ready" toggle button. Used on
   * the My PRs tab. The callback toggles auto-merge for that PR. */
  onToggleAutoMerge?: (id: { owner: string; repo: string; number: number; currentlyEnabled: boolean }) => void;
  /** When true, each row renders a small "copy PR link" button. Used on the
   * My PRs tab — handy for pasting your own PRs into Slack / Jira / etc. */
  showCopyLink?: boolean;
}

/** Per-row copy button: copies the PR's github.com URL and flashes a checkmark
 * for ~1.2s. Stops propagation so the click doesn't also open the drawer. */
function CopyLinkButton({ owner, repo, number }: { owner: string; repo: string; number: number }) {
  const [copied, setCopied] = useState(false);
  const url = `https://github.com/${owner}/${repo}/pull/${number}`;
  return (
    <button
      type="button"
      className={`pr-row-copy has-tooltip${copied ? ' pr-row-copy-copied' : ''}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch { /* clipboard may be unavailable in some contexts */ }
      }}
      data-tooltip={copied ? 'Copied!' : 'Copy PR link'}
      aria-label="Copy PR link"
    >
      {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
    </button>
  );
}

export function PRList({ prs, mode, onOpen, selection, claudeStateFor, onToggleAutoMerge, showCopyLink }: Props) {
  const filtered = mode === 'untouched-only' ? prs.filter((p) => p.status === 'untouched') : prs;
  if (filtered.length === 0) {
    return <p className="empty">No PRs to review.</p>;
  }
  // When any row in the list is selectable, every row needs the 3-column grid
  // template so columns line up — non-selectable rows render an empty cell in
  // the checkbox slot.
  const anySelectable = selection
    ? filtered.some((p) => selection.isSelectable?.({ owner: p.owner, repo: p.repo, number: p.number }) ?? true)
    : false;
  return (
    <ul className="pr-list">
      {filtered.map((p) => {
        // Carry the source-tagging fields through so the drawer can route local
        // entries to /api/local/* instead of GitHub.
        const id: Identity = {
          owner: p.owner,
          repo: p.repo,
          number: p.number,
          source: p.source,
          branch: p.branch,
          localPath: p.localPath,
        };
        const key = prKey(id);
        const rowSelectable = selection ? (selection.isSelectable?.(id) ?? true) : false;
        const selected = selection?.selectedKeys.has(key) ?? false;
        const opened = formatOpenedAt(p.createdAt);
        return (
          <li
            key={key}
            className={`pr-row${anySelectable ? ' pr-row-selectable' : ''}${selected ? ' pr-row-selected' : ''}`}
            onClick={() => onOpen(id)}
          >
            {anySelectable && (rowSelectable && selection ? (
              <label className="pr-row-checkbox" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => selection.onToggle(id)}
                  aria-label={`Select ${p.title}`}
                />
              </label>
            ) : (
              <span className="pr-row-checkbox-spacer" aria-hidden="true" />
            ))}
            <span className="pr-text">
              <span className="pr-title-row">
                <span className="pr-title">{p.title}</span>
                <LabelChips labels={p.labels} max={4} />
              </span>
              <span className="pr-meta">
                {p.owner}/{p.repo}#{p.number} · {p.authorLogin ?? 'unknown'}{opened ? ` · ${opened}` : ''}
              </span>
            </span>
            <span className="pr-badges">
              <ClaudeBadge state={claudeStateFor?.({ owner: p.owner, repo: p.repo, number: p.number }) ?? null} />
              <CiBadge status={p.ciStatus} url={p.ciUrl} />
              <GhStatusBadge status={p.ghStatus} />
              {/* StatusBadge returns null for 'untouched' (the default state),
                  so this just renders Reviewed / Approved chips when set. */}
              <StatusBadge status={p.status} />
              {/* My PRs tab: per-row "Copy PR link" button. Renders to the
                  left of the auto-merge toggle so both action icons sit in
                  the same trailing cluster. */}
              {showCopyLink && (
                <CopyLinkButton owner={p.owner} repo={p.repo} number={p.number} />
              )}
              {/* My PRs tab: per-row "Merge when ready" toggle. Clicking the
                  button stops propagation so it doesn't also open the drawer.
                  Three visual states:
                   - default: outlined green (not enabled)
                   - on:       filled green   (auto-merge enabled, not yet queued)
                   - queued:   filled amber + queue icon (in the merge queue) */}
              {onToggleAutoMerge && p.ghStatus !== 'merged' && p.ghStatus !== 'closed' && (() => {
                const queued = !!p.mergeQueueQueued;
                const enabled = !!p.autoMergeEnabled;
                const cls = queued ? 'pr-row-automerge pr-row-automerge-queued' : enabled ? 'pr-row-automerge pr-row-automerge-on' : 'pr-row-automerge';
                const label = queued ? 'Queued — click to cancel'
                  : enabled ? 'Cancel merge when ready'
                  : 'Merge when ready';
                return (
                  <button
                    type="button"
                    className={`${cls} has-tooltip`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleAutoMerge({ owner: p.owner, repo: p.repo, number: p.number, currentlyEnabled: enabled || queued });
                    }}
                    data-tooltip={label}
                    aria-label={label}
                  >
                    {queued ? <GitMergeQueueIcon size={16} /> : <GitMergeIcon size={16} />}
                  </button>
                );
              })()}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
