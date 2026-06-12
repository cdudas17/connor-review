import type { FastifyInstance } from 'fastify';
import { ghExec, GhCliError } from '../lib/ghExec.js';

export interface MyIssue {
  number: number;
  title: string;
  url: string;
  state: 'open' | 'closed';
  authorLogin: string | null;
  /** "owner/repo" */
  repository: string;
  createdAt: string;
  updatedAt: string;
  /** Comma-separated label names; we don't need the colors here. */
  labels: string[];
}

interface GhSearchIssueNode {
  number: number;
  title: string;
  url: string;
  state: string;
  author?: { login?: string };
  repository?: { nameWithOwner?: string };
  createdAt: string;
  updatedAt: string;
  labels?: Array<{ name?: string }>;
}

/**
 * Returns the viewer's open GitHub issues (assigned OR authored). Backed by
 * `gh search issues` so we don't have to know any orgs/repos up front — gh
 * searches across everything the user can see.
 */
export async function registerIssuesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { scope?: 'assigned' | 'authored' | 'either'; limit?: string } }>(
    '/api/issues/mine',
    async (req, reply) => {
      const scope = req.query.scope ?? 'either';
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
      // gh search issues uses GitHub's search syntax. `is:open is:issue` is the
      // baseline; the scope qualifier narrows assignee vs author. `either`
      // unions both with an OR.
      const query = (() => {
        if (scope === 'assigned') return 'is:open is:issue assignee:@me';
        if (scope === 'authored') return 'is:open is:issue author:@me';
        return 'is:open is:issue assignee:@me OR is:open is:issue author:@me';
      })();
      try {
        const out = await ghExec([
          'search', 'issues', query,
          '--json', 'number,title,url,state,author,repository,createdAt,updatedAt,labels',
          '--limit', String(limit),
        ]);
        const parsed = JSON.parse(out) as GhSearchIssueNode[];
        const issues: MyIssue[] = (Array.isArray(parsed) ? parsed : [])
          .map((n) => ({
            number: n.number,
            title: n.title,
            url: n.url,
            state: (n.state === 'open' ? 'open' : 'closed') as 'open' | 'closed',
            authorLogin: n.author?.login ?? null,
            repository: n.repository?.nameWithOwner ?? '',
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
            labels: (n.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
          }))
          .filter((i) => i.number > 0 && i.repository);
        // Most-recently-updated first — matches how the user would scan the list.
        issues.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        return { issues, scope, limit };
      } catch (e) {
        if (e instanceof GhCliError) {
          const status = e.code === 'AUTH_REQUIRED' ? 401
            : e.code === 'RATE_LIMITED' ? 429
            : e.code === 'GH_API_ERROR' ? 502
            : 500;
          reply.code(status).send({ code: e.code, message: e.message, stderr: e.stderr });
          return;
        }
        throw e;
      }
    },
  );
}
