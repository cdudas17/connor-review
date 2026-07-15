import type { PullRequestMeta, ReviewEvent, StagedInlineComment, TeamPR, CalendarEvent } from '../types.js';

export class ApiCallError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    /** Whole error body the server returned — preserves fields like
     * `details` / `files` / `stderr` that the route includes when its
     * top-level `message` is too short to be actionable. */
    public payload: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let payload: { code?: string; message?: string } & Record<string, unknown> = {};
    try { payload = await res.json(); } catch { /* ignore */ }
    throw new ApiCallError(payload.code ?? 'UNKNOWN', payload.message ?? res.statusText, res.status, payload);
  }
  const contentType = res.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? (res.json() as Promise<T>) : ((await res.text()) as unknown as T);
}

export type ReviewState = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';

interface ReviewSummary { id: string; state: ReviewState; }

export const api = {
  getPullRequest(owner: string, repo: string, number: number, opts?: { fresh?: boolean }): Promise<PullRequestMeta> {
    const qs = opts?.fresh ? '?fresh=1' : '';
    return call<PullRequestMeta>(`/api/pulls/${owner}/${repo}/${number}${qs}`);
  },
  getDiff(owner: string, repo: string, number: number, opts?: { fresh?: boolean }): Promise<string> {
    const qs = opts?.fresh ? '?fresh=1' : '';
    return call<string>(`/api/pulls/${owner}/${repo}/${number}/diff${qs}`);
  },
  /** Create a thread (single inline comment). Pass pullRequestReviewId to attach to a pending review. */
  createThread(owner: string, repo: string, number: number, body: StagedInlineComment & { pullRequestReviewId?: string }) {
    return call<{ id?: string }>(`/api/pulls/${owner}/${repo}/${number}/threads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  /**
   * Create a review. event=PENDING returns the new pending review id (which subsequent
   * thread creations and the submit endpoint use). The other events publish immediately.
   */
  createReview(owner: string, repo: string, number: number, body: {
    event: ReviewEvent | 'PENDING';
    body?: string;
    threads?: StagedInlineComment[];
  }): Promise<ReviewSummary> {
    return call<ReviewSummary>(`/api/pulls/${owner}/${repo}/${number}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  /** Submit a pending review with a final event + optional summary body. */
  submitPendingReview(owner: string, repo: string, number: number, reviewId: string, body: {
    event: ReviewEvent;
    body?: string;
  }): Promise<ReviewSummary> {
    return call<ReviewSummary>(`/api/pulls/${owner}/${repo}/${number}/reviews/${reviewId}/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  getTeamPRs(opts?: { repo?: string; path?: string; fresh?: boolean }): Promise<{ members: string[]; prs: TeamPR[] }> {
    const qs = new URLSearchParams();
    if (opts?.repo) qs.set('repo', opts.repo);
    if (opts?.path) qs.set('path', opts.path);
    if (opts?.fresh) qs.set('fresh', '1');
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return call(`/api/team/prs${suffix}`);
  },
  getLabeledPRs(label = 'needs-review', opts?: { fresh?: boolean }): Promise<{ label: string; prs: TeamPR[] }> {
    const qs = new URLSearchParams({ label });
    if (opts?.fresh) qs.set('fresh', '1');
    return call(`/api/labeled-prs?${qs.toString()}`);
  },
  getAuthoredPRs(author: string, opts?: { fresh?: boolean }): Promise<{ author: string; prs: TeamPR[] }> {
    const qs = new URLSearchParams({ author });
    if (opts?.fresh) qs.set('fresh', '1');
    return call(`/api/authored-prs?${qs.toString()}`);
  },
  getFileContent(owner: string, repo: string, number: number, path: string, ref: string): Promise<string> {
    const qs = new URLSearchParams({ path, ref });
    return call(`/api/pulls/${owner}/${repo}/${number}/files/content?${qs.toString()}`);
  },
  // ----- Local-branch endpoints (Local tab) -----
  getLocalMeta(repoName: string, localPath: string, branch: string): Promise<PullRequestMeta> {
    const qs = new URLSearchParams({ repo: repoName, path: localPath, branch });
    return call(`/api/local/meta?${qs.toString()}`);
  },
  getLocalDiff(localPath: string, branch: string, opts?: { fresh?: boolean }): Promise<string> {
    const qs = new URLSearchParams({ path: localPath, branch });
    if (opts?.fresh) qs.set('fresh', '1');
    return call(`/api/local/diff?${qs.toString()}`);
  },
  getLocalFileContent(localPath: string, file: string, ref: string): Promise<string> {
    const qs = new URLSearchParams({ path: localPath, file, ref });
    return call(`/api/local/files/content?${qs.toString()}`);
  },
  markReadyForReview(owner: string, repo: string, number: number): Promise<{ id: string; isDraft: boolean }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/ready-for-review`, { method: 'POST' });
  },
  /** Enable GitHub's auto-merge ("merge when ready"). Defaults to SQUASH method. */
  enableAutoMerge(owner: string, repo: string, number: number, opts?: { mergeMethod?: 'MERGE' | 'SQUASH' | 'REBASE' }): Promise<{ autoMergeRequest: { mergeMethod: 'MERGE' | 'SQUASH' | 'REBASE'; enabledBy: string | null; enabledAt: string | null } | null }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/auto-merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mergeMethod: opts?.mergeMethod ?? 'SQUASH' }),
    });
  },
  /** Disable GitHub's auto-merge. Idempotent — calling when not enabled is a no-op. */
  disableAutoMerge(owner: string, repo: string, number: number): Promise<{ autoMergeRequest: null }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/auto-merge`, { method: 'DELETE' });
  },
  /** Bounce the user's draft comment off the local `claude` CLI for feedback. Never posts to GitHub. */
  askClaude(
    owner: string,
    repo: string,
    number: number,
    body: {
      draft: string;
      lineRange?: { path: string; startLine?: number; endLine: number; side: 'LEFT' | 'RIGHT' };
      /** Prior turns so Claude has chat context on follow-ups. */
      conversation?: Array<{ role: 'user' | 'claude'; body: string }>;
      /** Local checkout path for the repo under review — `claude -p` runs with
       * this as its cwd so it can grep the actual codebase. */
      repoPath?: string;
    },
  ): Promise<{ response: string; truncatedDiff?: boolean }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/claude/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  /** Close the PR on GitHub without merging. Idempotent — closing an
   * already-closed PR is a no-op. */
  closePR(owner: string, repo: string, number: number): Promise<{ ok: true; state: 'CLOSED' }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/close`, { method: 'POST' });
  },
  /** Post a Trunk merge-bot slash command on the PR. Used for repos in
   * `trunkMergeRepos` where Trunk owns the merge queue (e.g. Gusto/web).
   * `action: 'enable'` posts `/trunk merge`; `'cancel'` posts `/trunk cancel`. */
  trunkMerge(
    owner: string,
    repo: string,
    number: number,
    body: { action: 'enable' | 'cancel' },
  ): Promise<{ ok: true; action: 'enable' | 'cancel'; body: string }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/trunk-merge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  /** Ask the server to fix the PR's currently failing CI builds in a local
   * worktree: install deps, hand the failing-check list to Claude with
   * Read/Edit/Write/Bash, then commit + push the result. Server returns
   * `{ ok, commitSha, filesChanged, failingChecksFixed }` on success,
   * `{ ok, noFailures: true }` if CI was already green, `{ ok, noChanges: true }`
   * if Claude concluded no edits were necessary, or one of the documented
   * error codes (INSTALL_FAILED, CLAUDE_NOT_INSTALLED, PUSH_FAILED, etc.). */
  fixCi(
    owner: string,
    repo: string,
    number: number,
    body: { repoPath: string },
  ): Promise<
    | { ok: true; commitSha: string; filesChanged: string[]; failingChecksFixed: string[]; noFailures?: undefined; noChanges?: undefined }
    | { ok: true; noFailures: true }
    | { ok: true; noChanges: true }
  > {
    return call(`/api/pulls/${owner}/${repo}/${number}/fix-ci`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  /** Ask the server to auto-resolve this PR's merge conflicts in a local
   * worktree, gate the result through safety checks, and push back to
   * GitHub. `repoPath` must point at the local clone — derive from
   * APP_CONFIG.localRepos. Server returns `{ ok, commitSha }` on success
   * or one of the documented error codes (LEFTOVER_MARKERS,
   * OVERCOMMIT_DETECTED, PUSH_FAILED, CLAUDE_NOT_INSTALLED, etc.). */
  resolveConflicts(
    owner: string,
    repo: string,
    number: number,
    body: { repoPath: string },
  ): Promise<{ ok: true; commitSha: string; trivial?: boolean }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/resolve-conflicts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  },
  /** Equivalent to GitHub's "Update branch" button — server hits
   *  `gh api -X PUT repos/.../pulls/N/update-branch`. Merges the PR's
   *  base branch into its head; CI re-runs on the up-to-date branch.
   *  Used by tag-driven workflows. */
  updateBranch(owner: string, repo: string, number: number): Promise<{ ok: true }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/update-branch`, { method: 'POST' });
  },
  /** The viewer's open GitHub issues (assigned + authored, most-recent first).
   * Pass `owner` (e.g. 'Gusto') to scope the search to a single GitHub org/user. */
  getMyIssues(opts?: { scope?: 'assigned' | 'authored' | 'either'; limit?: number; owner?: string }): Promise<{
    issues: Array<{
      number: number;
      title: string;
      url: string;
      state: 'open' | 'closed';
      authorLogin: string | null;
      repository: string;
      createdAt: string;
      updatedAt: string;
      labels: string[];
    }>;
    scope: string;
    limit: number;
  }> {
    const qs = new URLSearchParams();
    if (opts?.scope) qs.set('scope', opts.scope);
    if (opts?.limit) qs.set('limit', String(opts.limit));
    if (opts?.owner) qs.set('owner', opts.owner);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return call(`/api/issues/mine${suffix}`);
  },
  /** Full detail for a single issue — title + rendered body HTML + metadata.
   * Powers the issue drawer when the user clicks an entry on the Issues tab. */
  getIssue(owner: string, repo: string, number: number): Promise<{
    id: string;
    number: number;
    title: string;
    bodyHtml: string;
    state: 'open' | 'closed';
    authorLogin: string | null;
    authorAvatarUrl: string | null;
    assignees: Array<{ login: string; avatarUrl: string | null; url: string | null }>;
    labels: Array<{ name: string; color: string }>;
    createdAt: string;
    updatedAt: string;
    url: string;
    comments: Array<{
      id: string;
      bodyHtml: string;
      createdAt: string;
      url: string | null;
      authorLogin: string | null;
      authorAvatarUrl: string | null;
      authorUrl: string | null;
    }>;
  }> {
    return call(`/api/issues/${owner}/${repo}/${number}`);
  },
  /** Attach (or replace) labels on a PR.
   *  - mode='add' (default): append; existing labels stay.
   *  - mode='replace': set the label list to exactly `labels`; drops everything else. */
  addLabels(owner: string, repo: string, number: number, labels: string[], opts?: { mode?: 'add' | 'replace' }): Promise<{ ok: boolean }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ labels, mode: opts?.mode ?? 'add' }),
    });
  },
  /** Remove a single label from a PR by name. Idempotent. */
  removeLabel(owner: string, repo: string, number: number, label: string): Promise<{ ok: boolean; removed: string }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/labels/${encodeURIComponent(label)}`, { method: 'DELETE' });
  },
  replyToThread(owner: string, repo: string, number: number, threadId: string, body: string) {
    return call(`/api/pulls/${owner}/${repo}/${number}/threads/${threadId}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  },
  /** Bulk-resolve unresolved review threads on a PR. Pass `authorLogin` to
   *  restrict to threads STARTED BY that account (matched against the
   *  first comment's author). No filter → resolves every unresolved
   *  thread. Backs the `resolveThreads` workflow action. */
  resolveThreads(owner: string, repo: string, number: number, opts?: { authorLogin?: string }): Promise<{
    resolved: number;
    resolvedIds: string[];
    matched: number;
    authorLogin: string | null;
    errors: Array<{ threadId: string; message: string }>;
  }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/threads/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorLogin: opts?.authorLogin ?? undefined }),
    });
  },
  // --- Calendar (via local gcalcli CLI) ---
  getCalendarAuthStatus(): Promise<{ connected: boolean; configured: boolean; configurationError: string | null }> {
    return call('/api/calendar/auth-status');
  },
  getCalendarEvents(opts?: { start?: string; end?: string }): Promise<{
    events: CalendarEvent[];
    start: string;
    end: string;
  }> {
    const qs = new URLSearchParams();
    if (opts?.start) qs.set('start', opts.start);
    if (opts?.end) qs.set('end', opts.end);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return call(`/api/calendar/events${suffix}`);
  },

  /** Drill into a failing Buildkite CI check: fetches the build's annotations
   * (where rspec / jest / similar agents post failure summaries) so the CI
   * drawer can render per-test failure details inline. */
  getBuildkiteFailures(url: string): Promise<{
    org: string;
    pipeline: string;
    build: string;
    buildWebUrl: string;
    focusedJob: { id: string; name?: string; web_url?: string; state?: string; exit_status?: number | null } | null;
    failedJobs: Array<{ id: string; name?: string; web_url?: string; state?: string; exit_status?: number | null }>;
    annotations: Array<{ id: string; context: string; style: 'success' | 'info' | 'warning' | 'error'; body_html: string }>;
  }> {
    return call(`/api/buildkite/failures?url=${encodeURIComponent(url)}`);
  },
};
