import type { CiStatus } from '../types.js';

const CONFIG: Record<NonNullable<CiStatus>, { label: string; icon: string; cls: string }> = {
  SUCCESS: { label: 'CI', icon: '✓', cls: 'ci-success' },
  FAILURE: { label: 'CI', icon: '✗', cls: 'ci-failure' },
  ERROR: { label: 'CI', icon: '!', cls: 'ci-error' },
  PENDING: { label: 'CI', icon: '●', cls: 'ci-pending' },
  EXPECTED: { label: 'CI', icon: '○', cls: 'ci-expected' },
};

export function CiBadge({ status }: { status: CiStatus }) {
  if (status == null) return null;
  const c = CONFIG[status];
  return (
    <span className={`ci-badge ${c.cls}`} title={`CI: ${status.toLowerCase()}`}>
      <span className="ci-icon" aria-hidden="true">{c.icon}</span>
      {c.label}
    </span>
  );
}
