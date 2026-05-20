import type { PullRequestMeta } from '../types.js';

export function PRHeader({ meta }: { meta: PullRequestMeta }) {
  const stateLabel = meta.merged ? 'Merged' : meta.state === 'OPEN' ? 'Open' : 'Closed';
  return (
    <header className="pr-header">
      <h2>{meta.title}</h2>
      <p className="pr-header-meta">
        <a href={meta.url} target="_blank" rel="noopener noreferrer">#{meta.number}</a>
        {' · '}
        {meta.authorLogin ?? 'unknown'}
        {' · '}
        <code>{meta.headRefName}</code> → <code>{meta.baseRefName}</code>
        {' · '}
        <span className={`pr-state pr-state-${stateLabel.toLowerCase()}`}>{stateLabel}</span>
      </p>
    </header>
  );
}
