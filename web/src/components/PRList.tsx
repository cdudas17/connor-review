import type { TrackedPR } from '../types.js';
import { StatusBadge } from './StatusBadge.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { CiBadge } from './CiBadge.js';
import { LabelChips } from './LabelChips.js';
import type { FilterMode } from './FilterToggle.js';

interface Identity { owner: string; repo: string; number: number; }
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
  return (
    <ul className="pr-list">
      {filtered.map((p) => {
        const id = { owner: p.owner, repo: p.repo, number: p.number };
        const key = prKey(id);
        const rowSelectable = selection ? (selection.isSelectable?.(id) ?? true) : false;
        const selected = selection?.selectedKeys.has(key) ?? false;
        const opened = formatOpenedAt(p.createdAt);
        return (
          <li
            key={key}
            className={`pr-row${rowSelectable ? ' pr-row-selectable' : ''}${selected ? ' pr-row-selected' : ''}`}
            onClick={() => onOpen(id)}
          >
            {rowSelectable && selection && (
              <label className="pr-row-checkbox" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => selection.onToggle(id)}
                  aria-label={`Select ${p.title}`}
                />
              </label>
            )}
            {!rowSelectable && selection && <span className="pr-row-checkbox-spacer" aria-hidden="true" />}
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
              <StatusBadge status={p.status} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
