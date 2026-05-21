import type { TrackedPR } from '../types.js';
import { StatusBadge } from './StatusBadge.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { CiBadge } from './CiBadge.js';
import type { FilterMode } from './FilterToggle.js';

interface Identity { owner: string; repo: string; number: number; }
function prKey(id: Identity) { return `${id.owner}/${id.repo}#${id.number}`; }

interface Props {
  prs: TrackedPR[];
  mode: FilterMode;
  onOpen: (id: Identity) => void;
  /** When set, a checkbox is rendered on each row; clicks on the checkbox don't open the drawer. */
  selection?: {
    selectedKeys: Set<string>;
    onToggle: (id: Identity) => void;
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
        const selected = selection?.selectedKeys.has(key) ?? false;
        return (
          <li
            key={key}
            className={`pr-row${selection ? ' pr-row-selectable' : ''}${selected ? ' pr-row-selected' : ''}`}
            onClick={() => onOpen(id)}
          >
            {selection && (
              <label className="pr-row-checkbox" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => selection.onToggle(id)}
                  aria-label={`Select ${p.title}`}
                />
              </label>
            )}
            <span className="pr-title">{p.title}</span>
            <span className="pr-meta">{p.owner}/{p.repo}#{p.number} · {p.authorLogin ?? 'unknown'}</span>
            <span className="pr-badges">
              <CiBadge status={p.ciStatus} />
              <GhStatusBadge status={p.ghStatus} />
              <StatusBadge status={p.status} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
