import type { PullRequestMeta, ReviewEvent, StagedInlineComment } from '../types.js';

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

export const api = {
  getPullRequest(owner: string, repo: string, number: number, opts?: { fresh?: boolean }): Promise<PullRequestMeta> {
    const qs = opts?.fresh ? '?fresh=1' : '';
    return call<PullRequestMeta>(`/api/pulls/${owner}/${repo}/${number}${qs}`);
  },
  getDiff(owner: string, repo: string, number: number, opts?: { fresh?: boolean }): Promise<string> {
    const qs = opts?.fresh ? '?fresh=1' : '';
    return call<string>(`/api/pulls/${owner}/${repo}/${number}/diff${qs}`);
  },
  submitReview(owner: string, repo: string, number: number, body: {
    event: ReviewEvent; body?: string; comments?: StagedInlineComment[];
  }): Promise<{ data: { addPullRequestReview: { pullRequestReview: { id: string; state: string } } } }> {
    return call(`/api/pulls/${owner}/${repo}/${number}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
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
