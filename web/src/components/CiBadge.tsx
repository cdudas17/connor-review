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
}

export function CiBadge({ status, url }: Props) {
  if (status == null) return null;
  const c = CONFIG[status];
  const showLink = url && status !== 'SUCCESS';
  const content = (
    <>
      <span className="ci-icon" aria-hidden="true">{c.icon}</span>
      {c.label}
    </>
  );
  if (showLink) {
    return (
      <a
        className={`ci-badge ci-badge-link ${c.cls}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={`CI: ${status.toLowerCase()} — open build`}
        onClick={(e) => e.stopPropagation()}
      >
        {content}
      </a>
    );
  }
  return (
    <span className={`ci-badge ${c.cls}`} title={`CI: ${status.toLowerCase()}`}>
      {content}
    </span>
  );
}
