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
      // IMPORTANT: gh search issues does NOT accept `is:open` / `is:issue`
      // inside the query string — those qualifiers come back as zero-result
      // searches. Use the dedicated flags instead (`--state`, `--author`,
      // `--assignee`). And there's no OR-across-flags, so for scope='either'
      // we have to fire two scoped searches and merge.
      const JSON_FIELDS = 'number,title,url,state,author,repository,createdAt,updatedAt,labels';
      const runScopedSearch = async (kind: 'assigned' | 'authored'): Promise<GhSearchIssueNode[]> => {
        const flag = kind === 'assigned' ? '--assignee' : '--author';
        const out = await ghExec([
          'search', 'issues',
          flag, '@me',
          '--state', 'open',
          '--json', JSON_FIELDS,
          '--limit', String(limit),
        ]);
        const parsed = JSON.parse(out);
        return Array.isArray(parsed) ? parsed as GhSearchIssueNode[] : [];
      };

      try {
        const raw: GhSearchIssueNode[] = scope === 'assigned'
          ? await runScopedSearch('assigned')
          : scope === 'authored'
            ? await runScopedSearch('authored')
            : [...await runScopedSearch('assigned'), ...await runScopedSearch('authored')];

        // Dedupe by (repo, number). For scope='either' the two scoped searches
        // can both return an issue you're assigned to AND authored.
        const seen = new Set<string>();
        const issues: MyIssue[] = [];
        for (const n of raw) {
          const repository = n.repository?.nameWithOwner ?? '';
          if (!n.number || !repository) continue;
          const key = `${repository}#${n.number}`;
          if (seen.has(key)) continue;
          seen.add(key);
          issues.push({
            number: n.number,
            title: n.title,
            url: n.url,
            state: (n.state === 'open' ? 'open' : 'closed') as 'open' | 'closed',
            authorLogin: n.author?.login ?? null,
            repository,
            createdAt: n.createdAt,
            updatedAt: n.updatedAt,
            labels: (n.labels ?? []).map((l) => l.name ?? '').filter(Boolean),
          });
        }
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
