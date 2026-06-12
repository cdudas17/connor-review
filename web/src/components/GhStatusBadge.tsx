import type { GhStatus } from '../types.js';
import { GH_STATUS_LABEL } from '../lib/ghStatus.js';
import { CheckCircleFillIcon } from '@primer/octicons-react';

export function GhStatusBadge({ status }: { status: GhStatus | null }) {
  if (status == null) return <span className="gh-status gh-status-unknown">…</span>;
  // Approved: green check icon (Octicons CheckCircleFill) instead of a text
  // badge — easier to scan in a busy row. Other states stay textual since
  // they don't have a universally-understood single glyph.
  if (status === 'approved') {
    return (
      <span
        className="gh-status gh-status-approved gh-status-approved-icon"
        title={GH_STATUS_LABEL.approved}
        aria-label={GH_STATUS_LABEL.approved}
      >
        <CheckCircleFillIcon size={16} />
      </span>
    );
  }
  return <span className={`gh-status gh-status-${status}`}>{GH_STATUS_LABEL[status]}</span>;
}
