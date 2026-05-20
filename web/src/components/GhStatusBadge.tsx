import type { GhStatus } from '../types.js';
import { GH_STATUS_LABEL } from '../lib/ghStatus.js';

export function GhStatusBadge({ status }: { status: GhStatus | null }) {
  if (status == null) return <span className="gh-status gh-status-unknown">…</span>;
  return <span className={`gh-status gh-status-${status}`}>{GH_STATUS_LABEL[status]}</span>;
}
