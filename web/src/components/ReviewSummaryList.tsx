import { useState } from 'react';
import type { ReviewSummary } from '../types.js';
import { Avatar } from './Avatar.js';

function formatTimeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return 'just now';
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(t).toLocaleDateString();
}

const STATE_LABEL: Record<ReviewSummary['state'], string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  COMMENTED: 'Commented',
  DISMISSED: 'Dismissed',
  PENDING: 'Pending',
};
const STATE_CLS: Record<ReviewSummary['state'], string> = {
  APPROVED: 'review-state-approved',
  CHANGES_REQUESTED: 'review-state-changes',
  COMMENTED: 'review-state-commented',
  DISMISSED: 'review-state-dismissed',
  PENDING: 'review-state-pending',
};

export function ReviewSummaryList({ reviews }: { reviews: ReviewSummary[] }) {
  const [open, setOpen] = useState(true);
  if (!reviews || reviews.length === 0) return null;
  return (
    <section className="review-summaries">
      <header className="conversations-header">
        <button type="button" className="conversations-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <h3>Review summaries <span className="conversations-count">{reviews.length}</span></h3>
        </button>
      </header>
      {open && (
        <div className="review-summaries-list">
          {reviews.map((r) => (
            <article key={r.id} className="review-summary-card">
              <header className="review-summary-header">
                <Avatar url={r.authorAvatarUrl} login={r.authorLogin} />
                <strong>{r.authorLogin ?? '?'}</strong>
                <span className={`review-state-pill ${STATE_CLS[r.state]}`}>{STATE_LABEL[r.state]}</span>
                <time>{formatTimeAgo(r.createdAt)}</time>
              </header>
              <div className="markdown-body review-summary-body" dangerouslySetInnerHTML={{ __html: r.bodyHtml }} />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
