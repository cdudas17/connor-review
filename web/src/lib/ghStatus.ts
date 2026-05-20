import type { GhStatus, PullRequestMeta } from '../types.js';

export function computeGhStatus(meta: Pick<PullRequestMeta, 'state' | 'merged' | 'isDraft' | 'reviewDecision'>): GhStatus {
  if (meta.merged || meta.state === 'MERGED') return 'merged';
  if (meta.state === 'CLOSED') return 'closed';
  if (meta.isDraft) return 'draft';
  if (meta.reviewDecision === 'APPROVED') return 'approved';
  if (meta.reviewDecision === 'CHANGES_REQUESTED') return 'changes-requested';
  return 'open';
}

export const GH_STATUS_LABEL: Record<GhStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  'changes-requested': 'Changes requested',
  approved: 'Approved',
  merged: 'Merged',
  closed: 'Closed',
};
