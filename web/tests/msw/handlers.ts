import { http, HttpResponse } from 'msw';
import type { PullRequestMeta } from '../../src/types.js';

export const META_FIXTURE: PullRequestMeta = {
  id: 'PR_abc',
  number: 1,
  title: 'Test PR',
  authorLogin: 'octocat',
  state: 'OPEN',
  merged: false,
  isDraft: false,
  reviewDecision: 'REVIEW_REQUIRED',
  ciStatus: 'SUCCESS',
  ciUrl: null,
  labels: [],
  assignees: [],
  reviews: [],
  comments: [],
  createdAt: '2026-02-25T00:00:00Z',
  bodyHtml: '<p>Test PR description</p>',
  viewerPendingReviewId: null,
  baseRefName: 'main',
  headRefName: 'feature',
  headSha: 'sha-1',
  url: 'https://github.com/Gusto/zenpayroll/pull/1',
  reviewThreads: [],
};

export const META_FIXTURE_2: PullRequestMeta = { ...META_FIXTURE, id: 'PR_def', number: 2, title: 'Second PR', headSha: 'sha-2' };

export const DIFF_FIXTURE = `diff --git a/file.txt b/file.txt\nindex 0..1 100644\n--- a/file.txt\n+++ b/file.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n`;

export const handlers = [
  http.get('/api/notes', () => HttpResponse.json({ notes: '', path: '/tmp/notes.html' })),
  http.put('/api/notes', async () => new HttpResponse(null, { status: 204 })),
  http.get('/api/team/prs', () => HttpResponse.json({ members: [], prs: [] })),
  http.get('/api/authored-prs', () => HttpResponse.json({ author: '', prs: [] })),
  http.get('/api/pulls/:owner/:repo/:number', ({ params }) => {
    const n = Number(params.number);
    if (n === 2) return HttpResponse.json(META_FIXTURE_2);
    return HttpResponse.json(META_FIXTURE);
  }),
  http.get('/api/pulls/:owner/:repo/:number/diff', () => HttpResponse.text(DIFF_FIXTURE)),
  http.post('/api/pulls/:owner/:repo/:number/reviews', async () => HttpResponse.json({ data: { addPullRequestReview: { pullRequestReview: { id: 'R_1', state: 'APPROVED' } } } })),
  http.post('/api/pulls/:owner/:repo/:number/threads/:threadId/reply', async () => HttpResponse.json({ data: { addPullRequestReviewThreadReply: { comment: { id: 'C_1', body: 'ack' } } } })),
];
