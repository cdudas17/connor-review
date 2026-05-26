export type PRStatus = 'untouched' | 'reviewed' | 'approved';

export type GhStatus = 'draft' | 'open' | 'changes-requested' | 'approved' | 'merged' | 'closed';

export type CiStatus = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;

export interface PRLabel { name: string; color: string; }
export interface PRAssignee { login: string; avatarUrl: string | null; url: string | null; }

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
  /** URL of the buildkite/zenpayroll check, when present. */
  ciUrl: string | null;
  /** PR labels (name + GitHub hex color, no leading #). */
  labels: PRLabel[];
  /** Whether this PR is currently in draft state. Used by the Oncall tab. Optional/false for older entries. */
  isDraft?: boolean;
  /** ISO-8601 timestamp of when the PR was opened on GitHub. null until meta is fetched. */
  createdAt: string | null;
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
  ciUrl: string | null;
  labels: PRLabel[];
  assignees: PRAssignee[];
  createdAt: string | null;
  /** Pre-rendered GitHub-flavored markdown HTML for the PR body. Safe — GitHub sanitizes. */
  bodyHtml: string | null;
  /** Id of the viewer's existing pending review on this PR, if any. */
  viewerPendingReviewId: string | null;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  url: string;
  reviewThreads: ReviewThread[];
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  /** True when the line this comment was made on has changed in a later commit. */
  isOutdated: boolean;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  startSide: 'LEFT' | 'RIGHT' | null;
  diffSide: 'LEFT' | 'RIGHT' | null;
  comments: Array<{ id: string; authorLogin: string | null; authorAvatarUrl?: string | null; body: string; createdAt: string; diffHunk?: string | null }>;
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
  ciUrl: string | null;
  labels: PRLabel[];
  baseRefName: string;
  headRefName: string;
  headSha: string;
  createdAt: string | null;
  updatedAt: string;
}
