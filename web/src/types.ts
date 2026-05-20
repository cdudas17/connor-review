export type PRStatus = 'untouched' | 'reviewed' | 'approved';

export interface TrackedPR {
  owner: string;
  repo: string;
  number: number;
  title: string;
  authorLogin: string | null;
  status: PRStatus;
  addedAt: number;
}

export interface PullRequestMeta {
  id: string;
  number: number;
  title: string;
  authorLogin: string | null;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
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
