import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
    </svg>
  );
}

interface CiContext {
  name: string;
  state: string | null;
  url: string | null;
  isFailure: boolean;
}

type Bucket = 'failure' | 'pending' | 'skipped' | 'success';
function bucketOf(c: CiContext): Bucket {
  if (c.isFailure) return 'failure';
  const s = (c.state ?? '').toUpperCase();
  if (s === 'SKIPPED' || s === 'NEUTRAL') return 'skipped';
  if (s === 'SUCCESS') return 'success';
  return 'pending'; // QUEUED / IN_PROGRESS / PENDING / unknown
}
function iconFor(b: Bucket): string {
  return b === 'failure' ? '✗' : b === 'success' ? '✓' : b === 'skipped' ? '–' : '●';
}
function labelFor(b: Bucket): string {
  return b === 'failure' ? 'Failing' : b === 'success' ? 'Successful' : b === 'skipped' ? 'Skipped' : 'Pending';
}

/** Does this check come from Buildkite? Buildkite contexts always link to a
 * buildkite.com URL. The "Failures" view applies the Buildkite-style red-X
 * row treatment only to these — non-Buildkite failures (CircleCI, GitHub
 * Actions, etc.) keep the standard row layout. */
function isBuildkite(c: CiContext): boolean {
  if (!c.url) return false;
  try { return new URL(c.url).hostname.endsWith('buildkite.com'); }
  catch { return false; }
}

interface Props {
  /** PR identity for the checks panel — null hides the drawer. */
  target: { owner: string; repo: string; number: number } | null;
  /** Optional pre-supplied contexts (e.g. from an already-open drawer's meta).
   * When provided we skip the fetch on open and render immediately; the
   * drawer still re-fetches once mounted to pick up any drift. */
  contexts?: CiContext[];
  onClose: () => void;
  /** When provided AND there are failing checks, the header gains a "Fix CI"
   * button that fires the same Claude-driven fix flow as the drawer footer.
   * Pass `undefined` for local-branch PRs or any case where the action
   * shouldn't be offered. */
  onFixCi?: () => void;
  /** Set to true to render the button in its disabled / running state
   * (used while a fix-CI run is already in flight for this PR). */
  ciFixRunning?: boolean;
}

/** Click-target for the CI badge. Opens a right-side drawer listing every
 * CI check on the PR's head commit, grouped failing → pending → skipped →
 * passing. Each row shows the check's state icon, name, and a Details
 * link when one's available. Mirrors GitHub's "Some checks were not
 * successful" panel. */
export function CiChecksDrawer({ target, contexts: seedContexts, onClose, onFixCi, ciFixRunning }: Props) {
  const [contexts, setContexts] = useState<CiContext[] | null>(seedContexts ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Buildkite-style "All / Failures" tab toggle. Defaults to Failures whenever
  // the drawer opens with failures present — that's almost always what the
  // user wants to look at.
  const [viewMode, setViewMode] = useState<'all' | 'failures'>('all');

  useEffect(() => {
    if (!target) { setContexts(seedContexts ?? null); setError(null); return; }
    // If we have seed contexts, show them immediately but still fetch fresh
    // in the background — a click that opens the drawer expects current data.
    if (seedContexts) setContexts(seedContexts);
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getPullRequest(target.owner, target.repo, target.number, { fresh: true })
      .then((m) => { if (!cancelled) setContexts(m.ciContexts ?? []); })
      .catch((e) => { if (!cancelled) setError((e as ApiCallError).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // seedContexts intentionally excluded — we only want refetches on target change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.owner, target?.repo, target?.number]);

  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  const grouped = useMemo(() => {
    if (!contexts) return null;
    const out: Record<Bucket, CiContext[]> = { failure: [], pending: [], skipped: [], success: [] };
    for (const c of contexts) out[bucketOf(c)].push(c);
    // Stable name sort within each bucket.
    for (const k of Object.keys(out) as Bucket[]) out[k].sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [contexts]);

  // Default to the Failures view on the first contexts-load per drawer open
  // if there are failures — the user opens the drawer 95% of the time because
  // something is red. Refetches don't touch viewMode (so a manual 'All' click
  // sticks), and the flag resets when the drawer closes.
  const viewModeInitialized = useRef(false);
  useEffect(() => {
    if (target == null) {
      viewModeInitialized.current = false;
      setViewMode('all');
    }
  }, [target]);
  useEffect(() => {
    if (!target || viewModeInitialized.current || !grouped) return;
    if (grouped.failure.length > 0) setViewMode('failures');
    viewModeInitialized.current = true;
  }, [target, grouped]);

  if (!target) return null;
  return (
    <>
      <div className="drawer-backdrop ci-checks-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer ci-checks-drawer" aria-label={`CI checks for ${target.owner}/${target.repo}#${target.number}`}>
        <header className="ci-checks-header">
          <div className="ci-checks-header-row">
            <h2>CI checks</h2>
            <div className="ci-checks-header-actions">
              {onFixCi && grouped && grouped.failure.length > 0 && (
                <button
                  type="button"
                  className="btn-fix-ci ci-checks-fix-ci"
                  disabled={!!ciFixRunning}
                  onClick={onFixCi}
                  title={`Spin up a worktree, install deps, and ask Claude to fix the ${grouped.failure.length} failing check${grouped.failure.length === 1 ? '' : 's'}`}
                >
                  {ciFixRunning ? 'Fixing CI…' : `Fix CI (${grouped.failure.length})`}
                </button>
              )}
              <button
                type="button"
                className="drawer-close ci-checks-header-close has-tooltip"
                data-tooltip="Close (Esc)"
                aria-label="Close"
                onClick={onClose}
              >
                <CloseIcon size={18} />
              </button>
            </div>
          </div>
          <p className="ci-checks-summary">
            {grouped
              ? <>
                  {grouped.failure.length > 0 && <span className="ci-checks-summary-failure">{grouped.failure.length} failing</span>}
                  {grouped.failure.length > 0 && (grouped.pending.length + grouped.skipped.length + grouped.success.length > 0) && ', '}
                  {grouped.pending.length > 0 && <>{grouped.pending.length} pending{(grouped.skipped.length + grouped.success.length > 0) && ', '}</>}
                  {grouped.skipped.length > 0 && <>{grouped.skipped.length} skipped{grouped.success.length > 0 && ', '}</>}
                  {grouped.success.length > 0 && <span className="ci-checks-summary-success">{grouped.success.length} passing</span>}
                  {grouped.failure.length + grouped.pending.length + grouped.skipped.length + grouped.success.length === 0 && 'No checks reported for this commit.'}
                </>
              : loading
                ? <><span className="loading-spinner" aria-hidden="true" /> Loading…</>
                : error
                  ? <span className="ci-checks-summary-failure">{error}</span>
                  : null}
          </p>
          <p className="ci-checks-target">{target.owner}/{target.repo}#{target.number}</p>
          {/* Buildkite-style "All / Failures" tab toggle. Sits below the
            * summary so it doesn't fight with the title / Fix CI row. */}
          {grouped && (grouped.failure.length > 0 || viewMode === 'failures') && (
            <div className="ci-checks-view-toggle" role="tablist" aria-label="Filter checks">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'all'}
                className={`ci-checks-view-tab${viewMode === 'all' ? ' ci-checks-view-tab-on' : ''}`}
                onClick={() => setViewMode('all')}
              >
                All
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'failures'}
                className={`ci-checks-view-tab${viewMode === 'failures' ? ' ci-checks-view-tab-on' : ''}`}
                onClick={() => setViewMode('failures')}
              >
                Failures{grouped.failure.length > 0 ? ` (${grouped.failure.length})` : ''}
              </button>
            </div>
          )}
        </header>
        {grouped && (
          <ul className="ci-checks-list">
            {(viewMode === 'failures'
              ? (['failure'] as const)
              : (['failure', 'pending', 'skipped', 'success'] as const)
            ).flatMap((bucket) =>
              grouped[bucket].map((c) => {
                const bkStyled = bucket === 'failure' && isBuildkite(c);
                return (
                  <li key={`${bucket}:${c.name}`} className={`ci-checks-item ci-checks-${bucket}${bkStyled ? ' ci-checks-buildkite-failure' : ''}`}>
                    <span className="ci-checks-state-icon" aria-hidden="true">{iconFor(bucket)}</span>
                    <span className="ci-checks-item-body">
                      <span className="ci-checks-item-name">{c.name}</span>
                      <span className="ci-checks-item-status">{labelFor(bucket)}{c.state ? ` · ${c.state.toLowerCase()}` : ''}</span>
                    </span>
                    {c.url && (
                      <a className="ci-checks-item-details" href={c.url} target="_blank" rel="noopener noreferrer">Details</a>
                    )}
                  </li>
                );
              }),
            )}
            {viewMode === 'failures' && grouped.failure.length === 0 && (
              <li className="ci-checks-empty">No failing checks — all green!</li>
            )}
          </ul>
        )}
      </aside>
    </>
  );
}
