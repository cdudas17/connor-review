import { AlertIcon } from '@primer/octicons-react';

type State = 'idle' | 'running' | 'failed';

/** Renders an outlined amber alert circle when the PR has unresolved merge
 * conflicts. When `onClick` is provided the badge upgrades to a `<button>`
 * so the user can ask Claude to resolve them — `state` drives the visual:
 *  - 'idle'    → alert icon, "click to ask Claude to resolve" tooltip
 *  - 'running' → spinner, button disabled
 *  - 'failed'  → alert icon, "last attempt failed — click to retry" tooltip
 *
 * Two sizes:
 *  - 'row'    — 18×18 icon-only chip for the trailing badge cluster (PRList).
 *  - 'header' — wider pill with a label for the drawer header.
 *
 * Renders nothing when `hasConflicts` is false / undefined. */
export function ConflictBadge({
  hasConflicts,
  variant = 'row',
  onClick,
  state = 'idle',
}: {
  hasConflicts: boolean | undefined;
  variant?: 'row' | 'header';
  /** When provided, the badge is a button that fires this callback. */
  onClick?: () => void;
  state?: State;
}) {
  if (!hasConflicts) return null;
  const isHeader = variant === 'header';
  const tooltip = state === 'running'
    ? 'Claude is resolving merge conflicts…'
    : state === 'failed'
      ? 'Last attempt failed — click to retry'
      : onClick
        ? 'Merge conflicts — click to ask Claude to resolve'
        : isHeader
          ? 'This PR has unresolved merge conflicts with its base branch'
          : 'Merge conflicts';
  const ariaLabel = state === 'running' ? 'Resolving merge conflicts' : 'Merge conflicts';

  const iconNode = state === 'running'
    ? <span className="loading-spinner" aria-hidden="true" />
    : <AlertIcon size={isHeader ? 14 : 12} />;
  const label = isHeader ? (
    <>
      {iconNode}
      <span>{state === 'running' ? 'Resolving…' : state === 'failed' ? 'Resolution failed' : 'Merge conflicts'}</span>
    </>
  ) : iconNode;

  const className = `gh-status gh-status-conflict ${isHeader ? 'gh-status-conflict-pill' : 'gh-status-conflict-icon'} has-tooltip`;

  if (onClick) {
    return (
      <button
        type="button"
        className={className}
        data-tooltip={tooltip}
        aria-label={ariaLabel}
        disabled={state === 'running'}
        onClick={(e) => {
          e.stopPropagation();
          if (state === 'running') return;
          onClick();
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <span
      className={className}
      data-tooltip={tooltip}
      aria-label={ariaLabel}
    >
      {label}
    </span>
  );
}
