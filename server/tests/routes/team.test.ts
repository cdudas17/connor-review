import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildServer } from '../../src/index.js';

vi.mock('../../src/lib/ghExec.js', () => {
  const ghExec = vi.fn();
  class GhCliError extends Error {
    override readonly name = 'GhCliError';
    constructor(public code: string, message: string, public stderr: string) {
      super(message);
    }
  }
  return { ghExec, GhCliError };
});

import { ghExec } from '../../src/lib/ghExec.js';
const mocked = ghExec as unknown as ReturnType<typeof vi.fn>;

const TALENT_YML = `name: Talent
github:
  members:
    - alice
    - bob
    - cdudas17
`;

const SEARCH_RESPONSE = JSON.stringify({
  data: {
    search: {
      nodes: [
        // Open PR by alice — should be included
        {
          id: 'PR_1', number: 100, title: 'Refactor alice', url: 'https://github.com/Gusto/zenpayroll/pull/100',
          author: { login: 'alice' }, repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
          isDraft: false, state: 'OPEN', merged: false, reviewDecision: 'REVIEW_REQUIRED',
          baseRefName: 'main', headRefName: 'alice/r1', headRefOid: 'sha-100', updatedAt: '2026-05-19T00:00:00Z',
        },
        // Approved PR — should be filtered out
        {
          id: 'PR_2', number: 101, title: 'Approved already', url: 'x',
          author: { login: 'bob' }, repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
          isDraft: false, state: 'OPEN', merged: false, reviewDecision: 'APPROVED',
          baseRefName: 'main', headRefName: 'bob/r', headRefOid: 's', updatedAt: 'x',
        },
        // Draft PR — should be filtered out
        {
          id: 'PR_3', number: 102, title: 'Draft', url: 'x',
          author: { login: 'cdudas17' }, repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
          isDraft: true, state: 'OPEN', merged: false, reviewDecision: 'REVIEW_REQUIRED',
          baseRefName: 'main', headRefName: 'd', headRefOid: 's', updatedAt: 'x',
        },
        // Merged PR — should be filtered out
        {
          id: 'PR_4', number: 103, title: 'Merged', url: 'x',
          author: { login: 'alice' }, repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
          isDraft: false, state: 'MERGED', merged: true, reviewDecision: 'APPROVED',
          baseRefName: 'main', headRefName: 'm', headRefOid: 's', updatedAt: 'x',
        },
        // Changes-requested PR — should be included (needs re-review)
        {
          id: 'PR_5', number: 104, title: 'Needs changes', url: 'https://github.com/Gusto/zenpayroll/pull/104',
          author: { login: 'cdudas17' }, repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
          isDraft: false, state: 'OPEN', merged: false, reviewDecision: 'CHANGES_REQUESTED',
          baseRefName: 'main', headRefName: 'c/fix', headRefOid: 'sha-104', updatedAt: '2026-05-19T00:00:00Z',
        },
      ],
    },
  },
});

describe('team routes', () => {
  beforeEach(() => mocked.mockReset());

  it('GET /api/team/prs returns members + filtered PRs', async () => {
    // first call → contents of talent.yml (base64-encoded by gh --jq .content)
    mocked.mockResolvedValueOnce(Buffer.from(TALENT_YML).toString('base64') + '\n');
    // second call → graphql search
    mocked.mockResolvedValueOnce(SEARCH_RESPONSE);
    const app = await buildServer();
    const res = await app.inject({ url: '/api/team/prs' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.members).toEqual(['alice', 'bob', 'cdudas17']);
    expect(body.prs.map((p: { number: number }) => p.number).sort()).toEqual([100, 104]);
    expect(body.prs[0].owner).toBe('Gusto');
    expect(body.prs[0].repo).toBe('zenpayroll');

    // verify the search query included all the authors
    const searchCall = mocked.mock.calls[1][1] as { input?: string };
    const searchBody = JSON.parse(searchCall.input!);
    expect(searchBody.variables.q).toContain('author:alice');
    expect(searchBody.variables.q).toContain('author:bob');
    expect(searchBody.variables.q).toContain('author:cdudas17');
    expect(searchBody.variables.q).toContain('is:pr');
    expect(searchBody.variables.q).toContain('is:open');
    expect(searchBody.variables.q).toContain('draft:false');

    await app.close();
  });

  it('accepts custom repo and path query params', async () => {
    mocked.mockResolvedValueOnce(Buffer.from(TALENT_YML).toString('base64'));
    mocked.mockResolvedValueOnce(SEARCH_RESPONSE);
    const app = await buildServer();
    await app.inject({ url: '/api/team/prs?repo=foo/bar&path=teams/x.yml' });
    const firstCall = mocked.mock.calls[0][0] as string[];
    expect(firstCall).toContain('repos/foo/bar/contents/teams/x.yml');
    await app.close();
  });
});
