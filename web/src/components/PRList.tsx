import type { TrackedPR } from '../types.js';
import { StatusBadge } from './StatusBadge.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { CiBadge } from './CiBadge.js';
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
}

export function PRList({ prs, mode, onOpen, selection }: Props) {
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
              <CiBadge status={p.ciStatus} url={p.ciUrl} />
              <GhStatusBadge status={p.ghStatus} />
              {/* If GitHub already reports the PR as approved, the local
                  "Untouched" badge is contradictory noise — hide it. The user
                  can still see local statuses they set themselves (Reviewed,
                  Approved) so explicit local intent isn't hidden. */}
              {!(p.ghStatus === 'approved' && p.status === 'untouched') && (
                <StatusBadge status={p.status} />
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
