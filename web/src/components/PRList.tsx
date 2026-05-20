import type { TrackedPR } from '../types.js';
import { StatusBadge } from './StatusBadge.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { CiBadge } from './CiBadge.js';
import type { FilterMode } from './FilterToggle.js';

interface Props {
  prs: TrackedPR[];
  mode: FilterMode;
  onOpen: (id: { owner: string; repo: string; number: number }) => void;
}

export function PRList({ prs, mode, onOpen }: Props) {
  const filtered = mode === 'untouched-only' ? prs.filter((p) => p.status === 'untouched') : prs;
  if (filtered.length === 0) {
    return <p className="empty">No PRs to review.</p>;
  }
  return (
    <ul className="pr-list">
      {filtered.map((p) => (
        <li key={`${p.owner}/${p.repo}#${p.number}`} className="pr-row" onClick={() => onOpen({ owner: p.owner, repo: p.repo, number: p.number })}>
          <span className="pr-title">{p.title}</span>
          <span className="pr-meta">{p.owner}/{p.repo}#{p.number} · {p.authorLogin ?? 'unknown'}</span>
          <span className="pr-badges">
            <CiBadge status={p.ciStatus} />
            <GhStatusBadge status={p.ghStatus} />
            <StatusBadge status={p.status} />
          </span>
        </li>
      ))}
    </ul>
  );
}
