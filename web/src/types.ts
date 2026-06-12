export type PRStatus = 'untouched' | 'reviewed' | 'approved';

export type GhStatus = 'draft' | 'open' | 'changes-requested' | 'approved' | 'merged' | 'closed';

export type CiStatus = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;

export interface PRLabel { name: string; color: string; }
export interface PRAssignee { login: string; avatarUrl: string | null; url: string | null; }

/** Top-level review submission (the "Approved with comment" / "Commented" summary text). */
export interface ReviewSummary {
  id: string;
  state: 'COMMENTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED' | 'PENDING';
  body: string;
  bodyHtml: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  createdAt: string;
  url: string;
}

export interface TrackedPR {
  owner: string;
  repo: string;
  number: number;
  title: string;
  authorLogin: string | null;
  status: PRStatus;
  /** GitHub-side status (Draft/Open/Approved/etc.). null until meta is fetched. null for local entries. */
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
  /** Whether "merge when ready" is enabled. Refreshed from meta on drawer open
   * and after a toggle action; falls back to undefined for entries pre-feature. */
  autoMergeEnabled?: boolean;
  /** Discriminator for entries that aren't GitHub PRs. Defaults to 'github' for back-compat. */
  source?: 'github' | 'local';
  /** For local entries: the branch name (the synthetic `number` is derived from it). */
  branch?: string;
  /** For local entries: the absolute path to the working tree. */
  localPath?: string;
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
  reviews: ReviewSummary[];
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
  /** Auto-merge ("merge when ready") state. null = not enabled. */
  autoMergeRequest?: { mergeMethod: 'MERGE' | 'SQUASH' | 'REBASE'; enabledBy: string | null; enabledAt: string | null } | null;
  /** Whether the viewer can enable auto-merge on this PR. */
  viewerCanEnableAutoMerge?: boolean;
  /** Discriminator. Defaults to 'github' when omitted. */
  source?: 'github' | 'local';
  /** For local entries: the configured repo name (matches the AppConfig.localRepos key). */
  localRepo?: string;
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
  comments: Array<{ id: string; authorLogin: string | null; authorAvatarUrl?: string | null; body: string; bodyHtml?: string; createdAt: string; diffHunk?: string | null }>;
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
