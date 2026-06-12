import type { TrackedPR } from '../types.js';
import { StatusBadge } from './StatusBadge.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { CiBadge } from './CiBadge.js';
import { ClaudeBadge } from './ClaudeBadge.js';
import { LabelChips } from './LabelChips.js';
import type { FilterMode } from './FilterToggle.js';

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
}

function GitMergeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M5 3.254V3.25v.005a.75.75 0 1 1 0-.005ZM5 5.5V3.5a3.5 3.5 0 0 1 5.487-2.87l2.07-2.07a.75.75 0 1 1 1.06 1.06l-2.07 2.07A3.5 3.5 0 0 1 9 8.732V11.5a3.25 3.25 0 1 1-1.5 0V8.732A3.5 3.5 0 0 1 5 5.5ZM5.5 14.5a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm0-13a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z"/>
    </svg>
  );
}

export function PRList({ prs, mode, onOpen, selection, claudeStateFor, onToggleAutoMerge }: Props) {
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
              {/* If GitHub already reports the PR as approved, the local
                  "Untouched" badge is contradictory noise — hide it. The user
                  can still see local statuses they set themselves (Reviewed,
                  Approved) so explicit local intent isn't hidden. */}
              {!(p.ghStatus === 'approved' && p.status === 'untouched') && (
                <StatusBadge status={p.status} />
              )}
              {/* My PRs tab: per-row "Merge when ready" toggle. Clicking the
                  button stops propagation so it doesn't also open the drawer. */}
              {onToggleAutoMerge && p.ghStatus !== 'merged' && p.ghStatus !== 'closed' && (
                <button
                  type="button"
                  className={`pr-row-automerge${p.autoMergeEnabled ? ' pr-row-automerge-on' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleAutoMerge({ owner: p.owner, repo: p.repo, number: p.number, currentlyEnabled: !!p.autoMergeEnabled });
                  }}
                  title={p.autoMergeEnabled ? 'Auto-merge enabled — click to cancel' : 'Enable merge when ready'}
                  aria-label={p.autoMergeEnabled ? 'Cancel merge when ready' : 'Enable merge when ready'}
                >
                  <GitMergeIcon />
                  <span>{p.autoMergeEnabled ? 'Auto-merging' : 'Merge when ready'}</span>
                </button>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
