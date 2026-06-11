import type { PullRequestMeta, ReviewEvent, StagedInlineComment, TeamPR } from '../types.js';

export class ApiCallError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  if (!res.ok) {
    let payload: { code?: string; message?: string } = {};
    try { payload = await res.json(); } catch { /* ignore */ }
    throw new ApiCallError(payload.code ?? 'UNKNOWN', payload.message ?? res.statusText, res.status);
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
  /** Attach one or more labels to a PR. Idempotent — adding existing labels is a no-op. */
  addLabels(owner: string, repo: string, number: number, labels: string[]): Promise<{ ok: boolean }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/labels`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ labels }),
    });
  },
  replyToThread(owner: string, repo: string, number: number, threadId: string, body: string) {
    return call(`/api/pulls/${owner}/${repo}/${number}/threads/${threadId}/reply`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
  },
};
