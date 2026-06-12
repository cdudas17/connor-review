import type { ConflictResolutionEntry } from '../hooks/useConflictResolutions.js';

/** Drawer-level card that surfaces the latest conflict-resolution attempt's
 * state. Renders only when there's an entry; the parent should pass null /
 * skip mounting otherwise. */
export function ConflictResolutionCard({
  entry,
  onRetry,
  onDismiss,
}: {
  entry: ConflictResolutionEntry;
  /** Re-fire the resolve flow. Disabled while 'running'. */
  onRetry: () => void;
  /** Clear the stored entry. */
  onDismiss: () => void;
}) {
  if (entry.kind === 'running') {
    return (
      <section className="conflict-card conflict-card-running">
        <header className="conflict-card-header">
          <span className="loading-spinner" aria-hidden="true" />
          <h3>Claude is resolving merge conflicts…</h3>
        </header>
        <p className="conflict-card-body">
          This runs in a temporary worktree, with safety checks blocking any
          over-commit before pushing. Leave the drawer open or close it —
          either way, results land back here.
        </p>
      </section>
    );
  }
  if (entry.kind === 'success') {
    return (
      <section className="conflict-card conflict-card-success">
        <header className="conflict-card-header">
          <h3>Merge conflicts resolved</h3>
          <button type="button" className="conflict-card-dismiss" onClick={onDismiss}>Dismiss</button>
        </header>
        <p className="conflict-card-body">
          Pushed merge commit <code>{entry.commitSha?.slice(0, 8) ?? '(unknown sha)'}</code>.
          Refresh to see GitHub catch up.
        </p>
      </section>
    );
  }
  // failed
  return (
    <section className="conflict-card conflict-card-failed">
      <header className="conflict-card-header">
        <h3>Conflict resolution failed{entry.code ? ` — ${entry.code}` : ''}</h3>
        <div className="conflict-card-actions">
          <button type="button" className="conflict-card-retry" onClick={onRetry}>Try again</button>
          <button type="button" className="conflict-card-dismiss" onClick={onDismiss}>Dismiss</button>
        </div>
      </header>
      <pre className="conflict-card-error">{entry.error ?? 'No error message provided.'}</pre>
    </section>
  );
}
