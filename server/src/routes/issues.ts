import type { FastifyInstance } from 'fastify';
import { ghExec, GhCliError } from '../lib/ghExec.js';
import { ISSUE_DETAIL_QUERY } from '../queries/issue.graphql.js';

/** Short-lived in-memory cache for the /api/issues/mine endpoint. Each
 * call shells out to `gh search issues` (~2-5s), so absorbing repeat hits
 * from the client's auto-refresh / tab visit + manual refresh is worth a
 * small per-process cache. Keyed on the full {scope, owner, limit} tuple
 * so different config buckets don't collide. */
const myIssuesCache = new Map<string, { value: unknown; expiresAt: number }>();
const MY_ISSUES_TTL_MS = 60 * 1000;

/** Test-only helper: drop the in-memory cache between cases so a cached
 * success from one test doesn't short-circuit the next test's mocked
 * ghExec failure path. */
export function __resetIssuesCaches(): void {
  myIssuesCache.clear();
}

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
  app.get<{ Querystring: { scope?: 'assigned' | 'authored' | 'either'; limit?: string; owner?: string } }>(
    '/api/issues/mine',
    async (req, reply) => {
      const scope = req.query.scope ?? 'either';
      const limit = Math.min(Math.max(parseInt(req.query.limit ?? '50', 10) || 50, 1), 200);
      // Optional org/user filter so the My open issues widget can scope to a
      // single GitHub owner (e.g. `Gusto`). Trim to be defensive against
      // accidental whitespace; empty / undefined means "no filter".
      const owner = (req.query.owner ?? '').trim();
      // Cache hit — return immediately. Each `gh search issues` is multi-
      // second; this absorbs the client's auto-refresh + tab-visit duplication.
      const cacheKey = `${scope}::${owner}::${limit}`;
      const cached = myIssuesCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
      // IMPORTANT: gh search issues does NOT accept `is:open` / `is:issue`
      // inside the query string — those qualifiers come back as zero-result
      // searches. Use the dedicated flags instead (`--state`, `--author`,
      // `--assignee`). And there's no OR-across-flags, so for scope='either'
      // we have to fire two scoped searches and merge.
      const JSON_FIELDS = 'number,title,url,state,author,repository,createdAt,updatedAt,labels';
      const runScopedSearch = async (kind: 'assigned' | 'authored'): Promise<GhSearchIssueNode[]> => {
        const flag = kind === 'assigned' ? '--assignee' : '--author';
        const args = [
          'search', 'issues',
          flag, '@me',
          '--state', 'open',
          '--json', JSON_FIELDS,
          '--limit', String(limit),
        ];
        if (owner) { args.push('--owner', owner); }
        const out = await ghExec(args);
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
        const result = { issues, scope, limit };
        myIssuesCache.set(cacheKey, { value: result, expiresAt: Date.now() + MY_ISSUES_TTL_MS });
        return result;
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

  // Single-issue detail — title, rendered body HTML, state, author,
  // assignees, labels, timestamps. Powers the issue drawer's body panel.
  app.get<{ Params: { owner: string; repo: string; number: string } }>(
    '/api/issues/:owner/:repo/:number',
    async (req, reply) => {
      const owner = req.params.owner;
      const repo = req.params.repo;
      const number = parseInt(req.params.number, 10);
      if (!owner || !repo || !Number.isFinite(number)) {
        reply.code(400).send({ code: 'BAD_PARAMS', message: 'owner, repo, and numeric number are required' });
        return;
      }
      try {
        const out = await ghExec([
          'api', 'graphql',
          '-f', `query=${ISSUE_DETAIL_QUERY}`,
          '-F', `owner=${owner}`,
          '-F', `repo=${repo}`,
          '-F', `number=${number}`,
        ]);
        const parsed = JSON.parse(out) as {
          data?: {
            repository?: {
              issue?: {
                id: string;
                number: number;
                title: string;
                bodyHTML: string;
                state: 'OPEN' | 'CLOSED';
                author?: { login?: string; avatarUrl?: string };
                assignees?: { nodes?: Array<{ login?: string; avatarUrl?: string; url?: string }> };
                labels?: { nodes?: Array<{ name?: string; color?: string }> };
                createdAt: string;
                updatedAt: string;
                url: string;
                comments?: { nodes?: Array<{
                  id: string;
                  bodyHTML: string;
                  createdAt: string;
                  url?: string;
                  author?: { login?: string; avatarUrl?: string; url?: string };
                }> };
              };
            };
          };
        };
        const issue = parsed.data?.repository?.issue;
        if (!issue) {
          reply.code(404).send({ code: 'NOT_FOUND', message: `Issue ${owner}/${repo}#${number} not found` });
          return;
        }
        return {
          id: issue.id,
          number: issue.number,
          title: issue.title,
          bodyHtml: issue.bodyHTML ?? '',
          state: (issue.state === 'OPEN' ? 'open' : 'closed') as 'open' | 'closed',
          authorLogin: issue.author?.login ?? null,
          authorAvatarUrl: issue.author?.avatarUrl ?? null,
          assignees: (issue.assignees?.nodes ?? []).map((a) => ({
            login: a.login ?? '',
            avatarUrl: a.avatarUrl ?? null,
            url: a.url ?? null,
          })).filter((a) => a.login),
          labels: (issue.labels?.nodes ?? []).map((l) => ({ name: l.name ?? '', color: l.color ?? '888888' })).filter((l) => l.name),
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          url: issue.url,
          comments: (issue.comments?.nodes ?? []).map((c) => ({
            id: c.id,
            bodyHtml: c.bodyHTML ?? '',
            createdAt: c.createdAt,
            url: c.url ?? null,
            authorLogin: c.author?.login ?? null,
            authorAvatarUrl: c.author?.avatarUrl ?? null,
            authorUrl: c.author?.url ?? null,
          })),
        };
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
