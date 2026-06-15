import type { CiFixEntry } from '../hooks/useCiFixes.js';

/** Drawer-level card that surfaces the latest "Fix failing CI" attempt's
 * state. Mirrors ConflictResolutionCard. The parent should skip mounting
 * when stateFor(target) is null. */
export function CiFixCard({
  entry,
  onRetry,
  onDismiss,
}: {
  entry: CiFixEntry;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  if (entry.kind === 'running') {
    return (
      <section className="conflict-card conflict-card-running">
        <header className="conflict-card-header">
          <span className="loading-spinner" aria-hidden="true" />
          <h3>Claude is fixing the failing CI builds…</h3>
        </header>
        <p className="conflict-card-body">
          This installs dependencies in a fresh worktree, then iterates on the failing tests.
          Big repos can take several minutes. Leave the drawer open or close it — the result
          shows up here either way.
        </p>
      </section>
    );
  }
  if (entry.kind === 'no-failures') {
    return (
      <section className="conflict-card conflict-card-success">
        <header className="conflict-card-header">
          <h3>CI is already green</h3>
          <button type="button" className="conflict-card-dismiss" onClick={onDismiss}>Dismiss</button>
        </header>
        <p className="conflict-card-body">
          No failing checks on the PR's current head — nothing for Claude to do.
        </p>
      </section>
    );
  }
  if (entry.kind === 'no-changes') {
    return (
      <section className="conflict-card conflict-card-success">
        <header className="conflict-card-header">
          <h3>Claude made no changes</h3>
          <button type="button" className="conflict-card-dismiss" onClick={onDismiss}>Dismiss</button>
        </header>
        <p className="conflict-card-body">
          Claude inspected the failing builds and concluded no edits were needed locally —
          likely a flaky CI step or infra issue. Try retrying CI on GitHub.
        </p>
      </section>
    );
  }
  if (entry.kind === 'success') {
    return (
      <section className="conflict-card conflict-card-success">
        <header className="conflict-card-header">
          <h3>Pushed CI fix</h3>
          <button type="button" className="conflict-card-dismiss" onClick={onDismiss}>Dismiss</button>
        </header>
        <p className="conflict-card-body">
          Commit <code>{entry.commitSha?.slice(0, 8) ?? '?'}</code> pushed.
          {entry.failingChecksFixed && entry.failingChecksFixed.length > 0 && (
            <> Targeted checks: <code>{entry.failingChecksFixed.join(', ')}</code>.</>
          )}
          {entry.filesChanged && entry.filesChanged.length > 0 && (
            <> Changed <code>{entry.filesChanged.length}</code> file{entry.filesChanged.length === 1 ? '' : 's'}.</>
          )}
        </p>
      </section>
    );
  }
  // failed
  return (
    <section className="conflict-card conflict-card-failed">
      <header className="conflict-card-header">
        <h3>CI fix failed{entry.code ? ` — ${entry.code}` : ''}</h3>
        <div className="conflict-card-actions">
          <button type="button" className="conflict-card-retry" onClick={onRetry}>Try again</button>
          <button type="button" className="conflict-card-dismiss" onClick={onDismiss}>Dismiss</button>
        </div>
      </header>
      <pre className="conflict-card-error">{entry.error ?? 'No error message provided.'}</pre>
    </section>
  );
}
