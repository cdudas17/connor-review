import type { CiStatus } from '../types.js';

const CONFIG: Record<NonNullable<CiStatus>, { label: string; icon: string; cls: string }> = {
  SUCCESS: { label: 'CI', icon: '✓', cls: 'ci-success' },
  FAILURE: { label: 'CI', icon: '✗', cls: 'ci-failure' },
  ERROR: { label: 'CI', icon: '!', cls: 'ci-error' },
  PENDING: { label: 'CI', icon: '●', cls: 'ci-pending' },
  EXPECTED: { label: 'CI', icon: '○', cls: 'ci-expected' },
};

interface Props {
  status: CiStatus;
  /** Optional URL to the underlying build (e.g. buildkite). Linkified when CI isn't green. */
  url?: string | null;
  /** When true, the badge replaces its icon with a spinner — used to signal
   * an in-flight "Fix CI" run is targeting this PR. Color stays tied to the
   * underlying `status` so the user still sees what's currently red. */
  fixing?: boolean;
  /** Pass / total counts from the PR's rollup contexts. When provided,
   * renders "✓ N/M" / "✗ N/M" in GitHub-status-page style; otherwise the
   * badge falls back to the plain "CI" label. */
  counts?: { passed: number; total: number };
}

export function CiBadge({ status, url, fixing, counts }: Props) {
  if (status == null) return null;
  const c = CONFIG[status];
  const showLink = url && status !== 'SUCCESS';
  const haveCounts = counts != null && counts.total > 0;
  const label = haveCounts ? `${counts!.passed}/${counts!.total}` : c.label;
  const title = fixing
    ? `CI: ${status.toLowerCase()}${haveCounts ? ` (${counts!.passed} of ${counts!.total} passing)` : ''} — Claude is fixing this`
    : `CI: ${status.toLowerCase()}${haveCounts ? ` (${counts!.passed} of ${counts!.total} passing)` : ''}`;
  const content = (
    <>
      {fixing
        ? <span className="loading-spinner ci-badge-spinner" aria-hidden="true" />
        : <span className="ci-icon" aria-hidden="true">{c.icon}</span>}
      {label}
    </>
  );
  const cls = `ci-badge ${c.cls}${fixing ? ' ci-badge-fixing' : ''}`;
  if (showLink) {
    return (
      <a
        className={`${cls} ci-badge-link`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={fixing ? title : `CI: ${status.toLowerCase()} — open build`}
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </a>
    );
  }
  return (
    <span className={cls} title={title}>
      {content}
    </span>
  );
}
