import { useState } from 'react';
import type { TrackedPR } from '../types.js';
import { StatusBadge } from './StatusBadge.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { CiBadge } from './CiBadge.js';
import { ClaudeBadge } from './ClaudeBadge.js';
import { ConflictBadge } from './ConflictBadge.js';
import { LabelChips } from './LabelChips.js';
import type { FilterMode } from './FilterToggle.js';
import { GitMergeIcon, GitMergeQueueIcon, CopyIcon, CheckIcon } from '@primer/octicons-react';
import { WorkflowButton } from './WorkflowButton.js';
import type { PrWorkflow, WorkflowRun } from '../lib/workflowTypes.js';
import { workflowMatches } from '../lib/runWorkflow.js';

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
  /** Per-PR conflict-resolution state. When provided AND the PR has
   * `hasConflicts`, the ConflictBadge becomes a button driven by
   * `onResolveConflicts`. Distinct from `claudeStateFor` to keep the
   * Claude badge clean of conflict-resolution activity. */
  conflictStateFor?: (id: { owner: string; repo: string; number: number }) => { kind: 'running' | 'failed' | 'success' } | null;
  /** Click handler for the conflict badge. Fire-and-forget; the hook
   * reflects state changes via `conflictStateFor`. */
  onResolveConflicts?: (id: { owner: string; repo: string; number: number }) => void;
  /** Per-PR fix-CI state. When 'running', the CiBadge replaces its icon
   * with a spinner so the row signals an in-flight fix attempt. */
  ciFixStateFor?: (id: { owner: string; repo: string; number: number }) => { kind: 'running' | 'failed' | 'success' | 'no-failures' | 'no-changes' } | null;
  /** When set, clicking the CI badge on a row opens the per-check
   * breakdown drawer for that PR. */
  onOpenCiChecks?: (id: { owner: string; repo: string; number: number }) => void;
  /** When set, each row renders a "Merge when ready" toggle button. Used on
   * the My PRs tab. The callback toggles auto-merge for that PR. */
  onToggleAutoMerge?: (id: { owner: string; repo: string; number: number; currentlyEnabled: boolean }) => void;
  /** When true, each row renders a small "copy PR link" button. Used on the
   * My PRs tab — handy for pasting your own PRs into Slack / Jira / etc. */
  showCopyLink?: boolean;
  /** Tag-driven workflows the row may surface as pill buttons. Each
   *  workflow is rendered if it matches the row's title-tag + ciStatus. */
  workflows?: PrWorkflow[];
  /** Latest state for a given (workflow, PR) so the button can spin while
   *  running, dim while errored, etc. */
  workflowStateFor?: (workflowId: string, id: { owner: string; repo: string; number: number }) => WorkflowRun | null;
  /** Invoked when the user clicks a workflow pill. */
  onRunWorkflow?: (workflow: PrWorkflow, pr: TrackedPR) => void;
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

export function PRList({ prs, mode, onOpen, selection, claudeStateFor, conflictStateFor, onResolveConflicts, ciFixStateFor, onOpenCiChecks, onToggleAutoMerge, showCopyLink, workflows, workflowStateFor, onRunWorkflow }: Props) {
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
              {/* Merge conflicts get the leading position in the left-of-CI
                  cluster — they block forward progress regardless of CI or
                  review state, so this is the first signal worth seeing. */}
              <ConflictBadge
                hasConflicts={p.hasConflicts}
                state={conflictStateFor?.({ owner: p.owner, repo: p.repo, number: p.number })?.kind === 'running' ? 'running'
                  : conflictStateFor?.({ owner: p.owner, repo: p.repo, number: p.number })?.kind === 'failed' ? 'failed'
                  : 'idle'}
                onClick={onResolveConflicts ? () => onResolveConflicts({ owner: p.owner, repo: p.repo, number: p.number }) : undefined}
              />
              {/* Draft + Closed + Approved are the GhStatus values we surface
                  left-of-CI — Draft gates reviewability, Closed flags the PR
                  is dead, and Approved is high-signal "ready to merge". Other
                  states (merged, changes-requested) render to the right of CI. */}
              {(p.ghStatus === 'draft' || p.ghStatus === 'closed' || p.ghStatus === 'approved') && (
                <GhStatusBadge status={p.ghStatus} approvers={p.approvers} />
              )}
              {/* StatusBadge returns null for 'untouched' (the default state),
                  so this just renders Reviewed / Approved chips when set. Sits
                  to the left of CI so my own state on the PR is the first
                  signal in the cluster. Suppress the local 'approved' badge
                  when GitHub already shows its own approved check — otherwise
                  the row renders two identical green checks. */}
              {!(p.status === 'approved' && p.ghStatus === 'approved') && (
                <StatusBadge status={p.status} />
              )}
              <CiBadge
                status={p.ciStatus}
                url={p.ciUrl}
                counts={p.ciCounts}
                fixing={ciFixStateFor?.({ owner: p.owner, repo: p.repo, number: p.number })?.kind === 'running'}
                onClick={onOpenCiChecks ? () => onOpenCiChecks({ owner: p.owner, repo: p.repo, number: p.number }) : undefined}
              />
              {p.ghStatus !== 'draft' && p.ghStatus !== 'closed' && p.ghStatus !== 'approved' && (
                <GhStatusBadge status={p.ghStatus} approvers={p.approvers} />
              )}
              {/* Tag-driven workflows: a pill button per workflow whose tag
                  + ciStatus match this row. Only rendered when the parent
                  passes `workflows` (My PRs tab only in v1). */}
              {workflows && workflows.length > 0 && onRunWorkflow && workflows
                .filter((w) => workflowMatches(w, { title: p.title ?? '', ciStatus: p.ciStatus ?? null }))
                .map((w) => (
                  <WorkflowButton
                    key={w.id}
                    workflow={w}
                    state={workflowStateFor ? workflowStateFor(w.id, { owner: p.owner, repo: p.repo, number: p.number }) : null}
                    onClick={() => onRunWorkflow(w, p)}
                  />
                ))}
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
                // trunkInQueue is the authoritative "queued" signal for
                // Trunk-managed repos (GitHub's mergeQueueEntry is always
                // null there). It's also a stronger signal than autoMergeEnabled
                // for non-Trunk repos when set, which it won't be — so this
                // OR is safe everywhere.
                const queued = !!p.mergeQueueQueued || !!p.trunkInQueue;
                const enabled = !!p.autoMergeEnabled || !!p.trunkInQueue;
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
