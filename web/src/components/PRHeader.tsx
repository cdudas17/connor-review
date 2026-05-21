import type { CiStatus, GhStatus, PullRequestMeta } from '../types.js';
import { GhStatusBadge } from './GhStatusBadge.js';
import { CiBadge } from './CiBadge.js';
import { computeGhStatus } from '../lib/ghStatus.js';

interface Props {
  meta: PullRequestMeta;
  /** Latest values from the auto-refreshing list. Override the (potentially stale)
   *  values derived from the drawer's own meta fetch. */
  latestGhStatus?: GhStatus | null;
  latestCiStatus?: CiStatus;
  latestCiUrl?: string | null;
}

export function PRHeader({ meta, latestGhStatus, latestCiStatus, latestCiUrl }: Props) {
  const status = latestGhStatus ?? computeGhStatus(meta);
  const ci = latestCiStatus !== undefined ? latestCiStatus : meta.ciStatus;
  const ciUrl = latestCiUrl !== undefined ? latestCiUrl : meta.ciUrl;
  return (
    <header className="pr-header">
      <div className="pr-header-title">
        <h2>{meta.title}</h2>
        <GhStatusBadge status={status} />
        <CiBadge status={ci} url={ciUrl} />
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
