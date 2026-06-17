import type { GhStatus } from '../types.js';
import { GH_STATUS_LABEL } from '../lib/ghStatus.js';
import { CheckCircleFillIcon, GitPullRequestDraftIcon, GitPullRequestClosedIcon } from '@primer/octicons-react';

export function GhStatusBadge({ status, approvers }: { status: GhStatus | null; approvers?: string[] }) {
  if (status == null) return <span className="gh-status gh-status-unknown">…</span>;
  // 'open' is the default for a normal PR — rendering a chip for it is just
  // noise. Draft / approved / changes-requested / merged / closed still
  // render because each carries actual information.
  if (status === 'open') return null;
  // Approved: green check icon (Octicons CheckCircleFill) instead of a text
  // badge — easier to scan in a busy row. Tooltip surfaces the approvers'
  // logins ("Approved by alice, bob") when we have that info.
  if (status === 'approved') {
    const list = (approvers ?? []).filter(Boolean);
    const tooltip = list.length > 0
      ? `Approved by ${list.join(', ')}`
      : GH_STATUS_LABEL.approved;
    return (
      <span
        className="gh-status gh-status-approved gh-status-approved-icon has-tooltip"
        data-tooltip={tooltip}
        aria-label={tooltip}
      >
        <CheckCircleFillIcon size={16} />
      </span>
    );
  }
  // Draft: GitHub's own GitPullRequestDraft glyph inside an outlined grey
  // circle. Same visual weight as the Reviewed and Claude badges so the
  // trailing icon cluster reads consistently.
  if (status === 'draft') {
    return (
      <span
        className="gh-status gh-status-draft gh-status-draft-icon has-tooltip"
        data-tooltip={GH_STATUS_LABEL.draft}
        aria-label={GH_STATUS_LABEL.draft}
      >
        <GitPullRequestDraftIcon size={12} />
      </span>
    );
  }
  // Closed: GitHub's own GitPullRequestClosed glyph inside an outlined red
  // circle. Matches the Draft icon pattern so the row cluster stays uniform.
  if (status === 'closed') {
    return (
      <span
        className="gh-status gh-status-closed gh-status-closed-icon has-tooltip"
        data-tooltip={GH_STATUS_LABEL.closed}
        aria-label={GH_STATUS_LABEL.closed}
      >
        <GitPullRequestClosedIcon size={12} />
      </span>
    );
  }
  return <span className={`gh-status gh-status-${status}`}>{GH_STATUS_LABEL[status]}</span>;
}
