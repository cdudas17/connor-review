export type PRStatus = 'untouched' | 'reviewed' | 'approved';

export type GhStatus = 'draft' | 'open' | 'changes-requested' | 'approved' | 'merged' | 'closed';

export type CiStatus = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;

export interface TrackedPR {
  owner: string;
  repo: string;
  number: number;
  title: string;
  authorLogin: string | null;
  status: PRStatus;
  /** GitHub-side status (Draft/Open/Approved/etc.). null until meta is fetched. */
  ghStatus: GhStatus | null;
  /** Status check rollup from GitHub (covers Buildkite + any other CI). null when unknown / no checks. */
  ciStatus: CiStatus;
  addedAt: number;
}

export interface PullRequestMeta {
  id: string;
  number: number;
  title: string;
  authorLogin: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  isDraft: boolean;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  ciStatus: CiStatus;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  url: string;
  reviewThreads: ReviewThread[];
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  startSide: 'LEFT' | 'RIGHT' | null;
  diffSide: 'LEFT' | 'RIGHT' | null;
  comments: Array<{ id: string; authorLogin: string | null; body: string; createdAt: string }>;
}

export type ReviewEvent = 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';

export interface StagedInlineComment {
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  body: string;
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
}

export interface StagedThreadReply {
  threadId: string;
  body: string;
}

export interface ReviewDrafts {
  summary: string;
  inlineComments: StagedInlineComment[];
  replies: StagedThreadReply[];
}

/** PR returned from the team search endpoint. Shape is similar to TrackedPR but tagged. */
export interface TeamPR {
  id: string;
  owner: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  authorLogin: string | null;
  isDraft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  ciStatus: CiStatus;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  updatedAt: string;
}
