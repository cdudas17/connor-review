import type { PRStatus } from '../types.js';

const LABEL: Record<PRStatus, string> = {
  untouched: 'Untouched',
  reviewed: 'Reviewed',
  approved: 'Approved',
};

export function StatusBadge({ status }: { status: PRStatus }) {
  return <span className={`status-badge status-${status}`}>{LABEL[status]}</span>;
}
