import { AlertIcon } from '@primer/octicons-react';

/** Renders an outlined red alert circle when the PR has unresolved merge
 * conflicts. Two sizes:
 *  - 'row'   — 18×18 icon-only chip for the trailing badge cluster (PRList).
 *  - 'header'— wider pill with an "Merge conflicts" label for the drawer header.
 * Renders nothing when `hasConflicts` is false / undefined. */
export function ConflictBadge({
  hasConflicts,
  variant = 'row',
}: {
  hasConflicts: boolean | undefined;
  variant?: 'row' | 'header';
}) {
  if (!hasConflicts) return null;
  if (variant === 'header') {
    return (
      <span
        className="gh-status gh-status-conflict gh-status-conflict-pill has-tooltip"
        data-tooltip="This PR has unresolved merge conflicts with its base branch"
        aria-label="Merge conflicts"
      >
        <AlertIcon size={14} />
        <span>Merge conflicts</span>
      </span>
    );
  }
  return (
    <span
      className="gh-status gh-status-conflict gh-status-conflict-icon has-tooltip"
      data-tooltip="Merge conflicts"
      aria-label="Merge conflicts"
    >
      <AlertIcon size={12} />
    </span>
  );
}
