import { useState } from 'react';
import type { PrComment, ReviewSummary } from '../types.js';
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

interface Props {
  reviews: ReviewSummary[];
  /** Top-level PR conversation comments. Interleaved with `reviews` in
   *  chronological order — GitHub's PR page mixes them into one timeline,
   *  and splitting them into separate sections would fragment the read. */
  comments?: PrComment[];
}

type Entry =
  | { kind: 'review'; at: number; review: ReviewSummary }
  | { kind: 'comment'; at: number; comment: PrComment };

/** Renders the PR's conversation timeline: review summaries + top-level
 *  comments, interleaved by `createdAt`. The section header + collapse
 *  behaviour is unchanged from the old review-only version. */
export function ReviewSummaryList({ reviews, comments = [] }: Props) {
  const [open, setOpen] = useState(true);
  const entries: Entry[] = [
    ...reviews.map<Entry>((r) => ({ kind: 'review', at: Date.parse(r.createdAt) || 0, review: r })),
    ...comments.map<Entry>((c) => ({ kind: 'comment', at: Date.parse(c.createdAt) || 0, comment: c })),
  ].sort((a, b) => a.at - b.at);

  if (entries.length === 0) return null;
  return (
    <section className="review-summaries">
      <header className="conversations-header">
        <button type="button" className="conversations-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
          <h3>Conversation <span className="conversations-count">{entries.length}</span></h3>
        </button>
      </header>
      {open && (
        <div className="review-summaries-list">
          {entries.map((e) => e.kind === 'review'
            ? <ReviewCard key={`r:${e.review.id}`} r={e.review} />
            : <CommentCard key={`c:${e.comment.id}`} c={e.comment} />)}
        </div>
      )}
    </section>
  );
}

function ReviewCard({ r }: { r: ReviewSummary }) {
  return (
    <article className="review-summary-card">
      <header className="review-summary-header">
        <Avatar url={r.authorAvatarUrl} login={r.authorLogin} />
        <strong>{r.authorLogin ?? '?'}</strong>
        <span className={`review-state-pill ${STATE_CLS[r.state]}`}>{STATE_LABEL[r.state]}</span>
        <time>{formatTimeAgo(r.createdAt)}</time>
      </header>
      <div className="markdown-body review-summary-body" dangerouslySetInnerHTML={{ __html: r.bodyHtml }} />
    </article>
  );
}

function CommentCard({ c }: { c: PrComment }) {
  return (
    <article className="review-summary-card review-summary-card-comment">
      <header className="review-summary-header">
        <Avatar url={c.authorAvatarUrl} login={c.authorLogin} />
        {c.authorUrl
          ? <a href={c.authorUrl} target="_blank" rel="noopener noreferrer"><strong>{c.authorLogin ?? '?'}</strong></a>
          : <strong>{c.authorLogin ?? '?'}</strong>}
        {c.url
          ? <a href={c.url} target="_blank" rel="noopener noreferrer"><time>{formatTimeAgo(c.createdAt)}</time></a>
          : <time>{formatTimeAgo(c.createdAt)}</time>}
      </header>
      <div className="markdown-body review-summary-body" dangerouslySetInnerHTML={{ __html: c.bodyHtml }} />
    </article>
  );
}
