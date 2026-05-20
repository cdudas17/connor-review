import type { PullRequestMeta } from '../types.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { computeGhStatus } from '../lib/ghStatus.js';

export function PRHeader({ meta }: { meta: PullRequestMeta }) {
  const status = computeGhStatus(meta);
  return (
    <header className="pr-header">
      <div className="pr-header-title">
        <h2>{meta.title}</h2>
        <GhStatusBadge status={status} />
      </div>
      <p className="pr-header-meta">
        <a href={meta.url} target="_blank" rel="noopener noreferrer">#{meta.number}</a>
        {' · '}
        {meta.authorLogin ?? 'unknown'}
        {' · '}
        <code>{meta.headRefName}</code> → <code>{meta.baseRefName}</code>
      </p>
    </header>
  );
}
