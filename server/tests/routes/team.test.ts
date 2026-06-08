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
import { __resetTeamRouteCaches } from '../../src/routes/team.js';
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
  beforeEach(() => {
    mocked.mockReset();
    __resetTeamRouteCaches();
  });

  it('GET /api/team/prs returns 400 when repo + path are not provided', async () => {
    const app = await buildServer();
    const res = await app.inject({ url: '/api/team/prs' });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_PARAMS');
    await app.close();
  });

  it('GET /api/team/prs returns members + filtered PRs when repo + path are passed', async () => {
    // first call → contents of the team file (base64-encoded by gh --jq .content)
    mocked.mockResolvedValueOnce(Buffer.from(TALENT_YML).toString('base64') + '\n');
    // second call → graphql search
    mocked.mockResolvedValueOnce(SEARCH_RESPONSE);
    const app = await buildServer();
    const res = await app.inject({ url: '/api/team/prs?repo=Gusto/zenpayroll&path=config/teams/people_os/talent.yml' });
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

  it('paginates the search when GitHub reports hasNextPage (regression: team had >100 open PRs)', async () => {
    mocked.mockResolvedValueOnce(Buffer.from(TALENT_YML).toString('base64'));
    // First page: one PR + hasNextPage true
    mocked.mockResolvedValueOnce(JSON.stringify({
      data: {
        search: {
          pageInfo: { hasNextPage: true, endCursor: 'CURSOR_AAA' },
          nodes: [
            { id: 'PR_A', number: 200, title: 'page1', url: 'u', author: { login: 'alice' },
              repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
              isDraft: false, state: 'OPEN', merged: false, reviewDecision: 'REVIEW_REQUIRED',
              baseRefName: 'main', headRefName: 'b', headRefOid: 's1', updatedAt: 'x' },
          ],
        },
      },
    }));
    // Second page: one PR + hasNextPage false. This is the one that used to be invisible.
    mocked.mockResolvedValueOnce(JSON.stringify({
      data: {
        search: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { id: 'PR_B', number: 345306, title: 'older PR past row 100', url: 'u', author: { login: 'isab3l' },
              repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
              isDraft: false, state: 'OPEN', merged: false, reviewDecision: 'REVIEW_REQUIRED',
              baseRefName: 'main', headRefName: 'b', headRefOid: 's2', updatedAt: 'x' },
          ],
        },
      },
    }));
    const app = await buildServer();
    const res = await app.inject({ url: '/api/team/prs?repo=Gusto/zenpayroll&path=config/teams/people_os/talent.yml' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.prs.map((p: { number: number }) => p.number).sort()).toEqual([200, 345306]);

    // Confirm the second search call passed the cursor.
    const secondSearchCall = mocked.mock.calls[2][1] as { input?: string };
    const secondBody = JSON.parse(secondSearchCall.input!);
    expect(secondBody.variables.after).toBe('CURSOR_AAA');
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

  describe('GET /api/labeled-prs', () => {
    it('uses label:"needs-review" by default and does NOT filter drafts in the query', async () => {
      mocked.mockResolvedValueOnce(JSON.stringify({ data: { search: { nodes: [] } } }));
      const app = await buildServer();
      const res = await app.inject({ url: '/api/labeled-prs' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ label: 'needs-review', prs: [] });

      const callInput = mocked.mock.calls[0][1] as { input?: string };
      const body = JSON.parse(callInput.input!);
      expect(body.variables.q).toContain('is:pr');
      expect(body.variables.q).toContain('is:open');
      expect(body.variables.q).toContain('label:"needs-review"');
      // Critically: no draft filter (oncall workflow needs to see drafts).
      expect(body.variables.q).not.toContain('draft:false');
      await app.close();
    });

    it('honors a custom ?label= query param', async () => {
      mocked.mockResolvedValueOnce(JSON.stringify({ data: { search: { nodes: [] } } }));
      const app = await buildServer();
      const res = await app.inject({ url: '/api/labeled-prs?label=urgent' });
      expect(res.statusCode).toBe(200);
      expect(res.json().label).toBe('urgent');
      const callInput = mocked.mock.calls[0][1] as { input?: string };
      const body = JSON.parse(callInput.input!);
      expect(body.variables.q).toContain('label:"urgent"');
      await app.close();
    });

    it('keeps draft PRs (unlike /api/team/prs) and filters merged/approved', async () => {
      mocked.mockResolvedValueOnce(JSON.stringify({
        data: {
          search: {
            nodes: [
              // open draft → KEEP
              { id: 'p1', number: 1, title: 'draft', url: 'u', author: { login: 'a' },
                repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
                isDraft: true, state: 'OPEN', merged: false, reviewDecision: 'REVIEW_REQUIRED',
                baseRefName: 'main', headRefName: 'b', headRefOid: 's1', createdAt: 'x', updatedAt: 'y' },
              // open ready → KEEP
              { id: 'p2', number: 2, title: 'ready', url: 'u', author: { login: 'a' },
                repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
                isDraft: false, state: 'OPEN', merged: false, reviewDecision: 'REVIEW_REQUIRED',
                baseRefName: 'main', headRefName: 'b', headRefOid: 's2', createdAt: 'x', updatedAt: 'y' },
              // approved → DROP
              { id: 'p3', number: 3, title: 'approved', url: 'u', author: { login: 'a' },
                repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
                isDraft: false, state: 'OPEN', merged: false, reviewDecision: 'APPROVED',
                baseRefName: 'main', headRefName: 'b', headRefOid: 's3', createdAt: 'x', updatedAt: 'y' },
              // merged → DROP
              { id: 'p4', number: 4, title: 'merged', url: 'u', author: { login: 'a' },
                repository: { owner: { login: 'Gusto' }, name: 'zenpayroll' },
                isDraft: false, state: 'MERGED', merged: true, reviewDecision: 'APPROVED',
                baseRefName: 'main', headRefName: 'b', headRefOid: 's4', createdAt: 'x', updatedAt: 'y' },
            ],
          },
        },
      }));
      const app = await buildServer();
      const res = await app.inject({ url: '/api/labeled-prs' });
      const body = res.json();
      expect(body.prs.map((p: { number: number }) => p.number).sort()).toEqual([1, 2]);
      expect(body.prs.find((p: { number: number }) => p.number === 1).isDraft).toBe(true);
      expect(body.prs.find((p: { number: number }) => p.number === 2).isDraft).toBe(false);
      await app.close();
    });
  });

  describe('GET /api/authored-prs', () => {
    it('returns 400 when author is missing', async () => {
      const app = await buildServer();
      const res = await app.inject({ url: '/api/authored-prs' });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('BAD_PARAMS');
      await app.close();
    });

    it('builds the right search query and keeps drafts + approved (only excludes merged/closed)', async () => {
      mocked.mockResolvedValueOnce(JSON.stringify({
        data: {
          search: {
            nodes: [
              // open draft → KEEP
              { id: 'p1', number: 1, title: 'wip', url: 'u', author: { login: 'alice' },
                repository: { owner: { login: 'org' }, name: 'app' },
                isDraft: true, state: 'OPEN', merged: false, reviewDecision: null,
                baseRefName: 'main', headRefName: 'b', headRefOid: 's1', createdAt: 'x', updatedAt: 'y' },
              // approved-but-unmerged → KEEP (author's still on the hook to merge)
              { id: 'p2', number: 2, title: 'approved', url: 'u', author: { login: 'alice' },
                repository: { owner: { login: 'org' }, name: 'app' },
                isDraft: false, state: 'OPEN', merged: false, reviewDecision: 'APPROVED',
                baseRefName: 'main', headRefName: 'b', headRefOid: 's2', createdAt: 'x', updatedAt: 'y' },
              // merged → DROP
              { id: 'p3', number: 3, title: 'merged', url: 'u', author: { login: 'alice' },
                repository: { owner: { login: 'org' }, name: 'app' },
                isDraft: false, state: 'MERGED', merged: true, reviewDecision: 'APPROVED',
                baseRefName: 'main', headRefName: 'b', headRefOid: 's3', createdAt: 'x', updatedAt: 'y' },
            ],
          },
        },
      }));
      const app = await buildServer();
      const res = await app.inject({ url: '/api/authored-prs?author=alice' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.author).toBe('alice');
      expect(body.prs.map((p: { number: number }) => p.number).sort()).toEqual([1, 2]);

      const callInput = mocked.mock.calls[0][1] as { input?: string };
      const queryBody = JSON.parse(callInput.input!);
      expect(queryBody.variables.q).toContain('author:alice');
      expect(queryBody.variables.q).toContain('is:pr');
      expect(queryBody.variables.q).toContain('is:open');
      // Drafts are intentionally NOT filtered out in the search query.
      expect(queryBody.variables.q).not.toContain('draft:false');
      await app.close();
    });
  });
});
