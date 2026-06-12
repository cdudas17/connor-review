import type { PRStatus } from '../types.js';
import { CheckCircleFillIcon, CommentIcon } from '@primer/octicons-react';

const LABEL: Record<PRStatus, string> = {
  untouched: 'Untouched',
  reviewed: 'Reviewed',
  approved: 'Approved',
};

export function StatusBadge({ status }: { status: PRStatus }) {
  // 'untouched' is the default state for every PR — rendering a chip for it
  // is visual noise. Callers can keep handing us the status; we just don't
  // draw anything.
  if (status === 'untouched') return null;
  // Local approved state uses the same green checkmark icon as the GitHub
  // approved state (see GhStatusBadge) so the visual is consistent across
  // every tab regardless of which source set the status.
  if (status === 'approved') {
    return (
      <span
        className="status-badge status-approved status-approved-icon has-tooltip"
        data-tooltip={LABEL.approved}
        aria-label={LABEL.approved}
      >
        <CheckCircleFillIcon size={16} />
      </span>
    );
  }
  // Local 'reviewed' renders as a comment glyph inside an outlined blue
  // circle — matches the visual weight of the approved checkmark + Claude
  // badge so the trailing badge cluster reads as a row of equal-sized icons.
  return (
    <span
      className="status-badge status-reviewed status-reviewed-icon has-tooltip"
      data-tooltip={LABEL.reviewed}
      aria-label={LABEL.reviewed}
    >
      <CommentIcon size={12} />
    </span>
  );
}
