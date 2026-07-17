interface Props {
  /** True while the rebase HTTP request is in flight for this PR. */
  running: boolean;
}

/** Row badge: shown only while a rebase is actively running against this
 *  PR. Session-local (not persisted) — mirrors the transient nature of
 *  the flow. When the rebase settles (success or failure), the parent
 *  drops the PR key from its running set and the badge disappears; the
 *  outcome surfaces as a toast, not as a lingering row indicator. */
export function RebaseBadge({ running }: Props) {
  if (!running) return null;
  return (
    <span
      className="rebase-badge has-tooltip"
      data-tooltip="Rebasing this PR onto its base branch — Claude is resolving conflicts if any"
      aria-label="Rebasing"
    >
      <span className="loading-spinner rebase-badge-spinner" aria-hidden="true" />
      <span className="rebase-badge-label">Rebasing</span>
    </span>
  );
}
