import type { FastifyInstance } from 'fastify';
import yaml from 'js-yaml';
import { ghExec } from '../lib/ghExec.js';
import { TEAM_PR_SEARCH_QUERY } from '../queries/teamPRs.graphql.js';
import { extractBuildkiteCheckUrl } from '../lib/ciUrl.js';

/**
 * Tiny TTL cache. Used to de-dupe overlapping calls to the same external API
 * (e.g. the team-PR search when the auto-refresh tick races with a manual
 * Refresh) and to avoid hammering GitHub during a flurry of requests.
 */
class TtlCache<V> {
  private readonly map = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) { this.map.delete(key); return undefined; }
    return hit.value;
  }
  set(key: string, value: V): void {
    this.map.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
  clear(): void { this.map.clear(); }
}

// Talent.yml file rarely changes — caching the parsed member list avoids a REST
// round trip on every team-PR fetch.
const membersCache = new TtlCache<string[]>(10 * 60 * 1000);
// Team-PR search results — short TTL to de-dupe overlapping refreshes without
// noticeably staling the list.
const teamSearchCache = new TtlCache<{ members: string[]; prs: TeamPR[] }>(30 * 1000);
// Same idea for authored / labeled searches.
const authoredCache = new TtlCache<{ author: string; prs: TeamPR[] }>(30 * 1000);
const labeledCache = new TtlCache<{ label: string; prs: TeamPR[] }>(30 * 1000);

/** Test-only helper to drop in-memory caches between cases. */
export function __resetTeamRouteCaches(): void {
  membersCache.clear();
  teamSearchCache.clear();
  authoredCache.clear();
  labeledCache.clear();
}

type CiStatus = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'ERROR' | 'EXPECTED' | null;

interface TeamPR {
  id: string;
  number: number;
  title: string;
  url: string;
  authorLogin: string | null;
  owner: string;
  repo: string;
  isDraft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  ciStatus: CiStatus;
  ciUrl: string | null;
  labels: Array<{ name: string; color: string }>;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  createdAt: string | null;
  updatedAt: string;
  // Auto-merge + merge-queue surface for the My PRs / Team PRs rows. Both
  // are best-effort: a search result that doesn't include them simply renders
  // the default (not enabled, not queued) state.
  autoMergeEnabled: boolean;
  mergeQueueQueued: boolean;
}

interface TalentFile {
  github?: {
    members?: string[];
  };
}

async function fetchTalentMembers(repo: string, path: string, opts: { fresh?: boolean } = {}): Promise<string[]> {
  const cacheKey = `${repo}::${path}`;
  if (!opts.fresh) {
    const cached = membersCache.get(cacheKey);
    if (cached) return cached;
  }
  const members = await _fetchTalentMembersFresh(repo, path);
  membersCache.set(cacheKey, members);
  return members;
}

async function _fetchTalentMembersFresh(repo: string, path: string): Promise<string[]> {
  const out = await ghExec(['api', `repos/${repo}/contents/${path}`, '--jq', '.content']);
  const trimmed = out.trim().replace(/"/g, '');
  if (!trimmed) throw new Error(`talent file ${repo}:${path} is empty`);
  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');
  const parsed = yaml.load(decoded) as TalentFile | null;
  const members = parsed?.github?.members;
  if (!Array.isArray(members) || members.length === 0) {
    throw new Error(`talent file ${repo}:${path} has no github.members`);
  }
  return members.filter((m) => typeof m === 'string' && m.length > 0);
}

/** GitHub search caps `first` at 100. Active teams routinely exceed that, so we
 * paginate. 5 pages = 500 PRs — well above any realistic open-PR backlog for
 * one team, but bounded so a misconfigured query doesn't loop forever. */
const MAX_SEARCH_PAGES = 5;

interface SearchNode {
  id: string;
  number: number;
  title: string;
  url: string;
  author?: { login?: string };
  repository?: { owner?: { login?: string }; name?: string };
  isDraft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  merged: boolean;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  createdAt?: string;
  updatedAt: string;
  labels?: { nodes?: Array<{ name?: string; color?: string }> };
  autoMergeRequest?: { mergeMethod?: string } | null;
  mergeQueueEntry?: { state?: string; position?: number | null } | null;
  commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string; contexts?: { nodes?: Array<{ __typename?: string; context?: string; name?: string; targetUrl?: string | null; detailsUrl?: string | null; state?: string; status?: string; conclusion?: string | null }> } } } }> };
}

/** Walk paginated search results, concatenating up to MAX_SEARCH_PAGES pages.
 *
 * If a follow-up page fails after the retries in ghExec are exhausted, return
 * the pages we already have rather than throwing the whole list away — a
 * partial team list is much more useful than an empty error toast. The first
 * page failing is still a hard error, since the user has nothing to look at.
 */
async function searchAllPages(q: string): Promise<SearchNode[]> {
  const all: SearchNode[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_SEARCH_PAGES; page++) {
    const variables: Record<string, unknown> = { q };
    if (after) variables.after = after;
    let out: string;
    try {
      out = await ghExec(['api', 'graphql', '--input', '-'], {
        input: JSON.stringify({ query: TEAM_PR_SEARCH_QUERY, variables }),
      });
    } catch (err) {
      if (page === 0) throw err;
      // Mid-pagination failure → return what we have. Log for debugging; surface
      // a one-line warning so the dev console hints at "results may be partial".
      console.warn(`[team-prs] page ${page + 1} fetch failed, returning ${all.length} partial results:`, (err as Error).message);
      break;
    }
    const parsed = JSON.parse(out) as {
      data?: {
        search?: {
          pageInfo?: { hasNextPage: boolean; endCursor: string | null };
          nodes?: SearchNode[];
        };
      };
    };
    const nodes = parsed.data?.search?.nodes ?? [];
    all.push(...nodes);
    const pageInfo = parsed.data?.search?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }
  return all;
}

async function searchTeamPRs(members: string[]): Promise<TeamPR[]> {
  // is:pr is:open draft:false author:user1 author:user2 ...
  // Multiple author: qualifiers are OR'd by GitHub search.
  const q = ['is:pr', 'is:open', 'draft:false', ...members.map((m) => `author:${m}`)].join(' ');
  const nodes = await searchAllPages(q);
  return nodes
    .filter((n) => n && n.id && !n.merged && n.state === 'OPEN' && !n.isDraft && n.reviewDecision !== 'APPROVED')
    .map((n) => ({
      id: n.id,
      number: n.number,
      title: n.title,
      url: n.url,
      authorLogin: n.author?.login ?? null,
      owner: n.repository?.owner?.login ?? '',
      repo: n.repository?.name ?? '',
      isDraft: n.isDraft,
      state: n.state,
      merged: n.merged,
      reviewDecision: n.reviewDecision,
      ciStatus: (n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null) as CiStatus,
      ciUrl: extractBuildkiteCheckUrl(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
      labels: (n.labels?.nodes ?? []).map((l) => ({ name: l.name ?? '', color: l.color ?? '888888' })).filter((l) => l.name),
      baseRefName: n.baseRefName,
      headRefName: n.headRefName,
      headSha: n.headRefOid,
      createdAt: n.createdAt ?? null,
      updatedAt: n.updatedAt,
      autoMergeEnabled: n.autoMergeRequest != null,
      mergeQueueQueued: n.mergeQueueEntry != null,
    }))
    .filter((p) => p.owner && p.repo);
}

export async function registerTeamRoutes(app: FastifyInstance) {
  // Returns the open, non-draft, non-approved PRs authored by members of the given talent.yml.
  // Defaults to Gusto/zenpayroll's config/teams/people_os/talent.yml.
  app.get<{ Querystring: { repo?: string; path?: string; fresh?: string } }>(
    '/api/team/prs',
    async (req, reply) => {
      const repo = req.query.repo;
      const path = req.query.path;
      const fresh = req.query.fresh === '1';
      if (!repo || !path) {
        reply.code(400).send({ code: 'BAD_PARAMS', message: 'repo and path query params are required' });
        return;
      }
      const cacheKey = `${repo}::${path}`;
      if (!fresh) {
        const cached = teamSearchCache.get(cacheKey);
        if (cached) return cached;
      }
      const members = await fetchTalentMembers(repo, path, { fresh });
      const prs = await searchTeamPRs(members);
      const result = { members, prs };
      teamSearchCache.set(cacheKey, result);
      return result;
    },
  );

  // Returns open PRs authored by a single GitHub login. Includes drafts (the
  // user's own work-in-progress is useful to see in the My PRs tab) and does
  // NOT filter out approved-but-unmerged PRs (those might still need action
  // from the author).
  app.get<{ Querystring: { author?: string; fresh?: string } }>(
    '/api/authored-prs',
    async (req, reply) => {
      const author = req.query.author;
      const fresh = req.query.fresh === '1';
      if (!author) {
        reply.code(400).send({ code: 'BAD_PARAMS', message: 'author query param is required' });
        return;
      }
      if (!fresh) {
        const cached = authoredCache.get(author);
        if (cached) return cached;
      }
      const q = ['is:pr', 'is:open', `author:${author}`].join(' ');
      const nodes = await searchAllPages(q);
      const prs: TeamPR[] = nodes
        // Keep drafts and approved-but-unmerged — author still owns the next move.
        .filter((n) => n && n.id && !n.merged && n.state === 'OPEN')
        .map((n) => ({
          id: n.id!,
          number: n.number!,
          title: n.title ?? '',
          url: n.url ?? '',
          authorLogin: n.author?.login ?? null,
          owner: n.repository?.owner?.login ?? '',
          repo: n.repository?.name ?? '',
          isDraft: !!n.isDraft,
          state: n.state!,
          merged: !!n.merged,
          reviewDecision: n.reviewDecision ?? null,
          ciStatus: (n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null) as CiStatus,
          ciUrl: extractBuildkiteCheckUrl(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
          labels: (n.labels?.nodes ?? []).map((l) => ({ name: l.name ?? '', color: l.color ?? '888888' })).filter((l) => l.name),
          baseRefName: n.baseRefName ?? 'main',
          headRefName: n.headRefName ?? '',
          headSha: n.headRefOid ?? '',
          createdAt: n.createdAt ?? null,
          updatedAt: n.updatedAt ?? new Date().toISOString(),
          autoMergeEnabled: n.autoMergeRequest != null,
          mergeQueueQueued: n.mergeQueueEntry != null,
        }))
        .filter((p) => p.owner && p.repo);
      const result = { author, prs };
      authoredCache.set(author, result);
      return result;
    },
  );

  // Returns open, non-draft, non-approved PRs that carry the given label. The
  // caller passes `?label=` (e.g. `needs-review`); filtering happens server-side.
  app.get<{ Querystring: { label?: string; fresh?: string } }>(
    '/api/labeled-prs',
    async (req) => {
      const label = req.query.label ?? 'needs-review';
      const fresh = req.query.fresh === '1';
      if (!fresh) {
        const cached = labeledCache.get(label);
        if (cached) return cached;
      }
      // No draft filter — caller filters drafts vs ready-for-review client-side.
      const q = ['is:pr', 'is:open', `label:"${label}"`].join(' ');
      const nodes = await searchAllPages(q);
      const prs: TeamPR[] = nodes
        // Keep drafts for the oncall workflow — they are the ones that need triaging.
        .filter((n) => n && n.id && !n.merged && n.state === 'OPEN' && n.reviewDecision !== 'APPROVED')
        .map((n) => ({
          id: n.id!,
          number: n.number!,
          title: n.title ?? '',
          url: n.url ?? '',
          authorLogin: n.author?.login ?? null,
          owner: n.repository?.owner?.login ?? '',
          repo: n.repository?.name ?? '',
          isDraft: !!n.isDraft,
          state: n.state!,
          merged: !!n.merged,
          reviewDecision: n.reviewDecision ?? null,
          ciStatus: (n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null) as CiStatus,
          ciUrl: extractBuildkiteCheckUrl(n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes),
          labels: (n.labels?.nodes ?? []).map((l) => ({ name: l.name ?? '', color: l.color ?? '888888' })).filter((l) => l.name),
          baseRefName: n.baseRefName ?? 'main',
          headRefName: n.headRefName ?? '',
          headSha: n.headRefOid ?? '',
          createdAt: n.createdAt ?? null,
          updatedAt: n.updatedAt ?? new Date().toISOString(),
          autoMergeEnabled: n.autoMergeRequest != null,
          mergeQueueQueued: n.mergeQueueEntry != null,
        }))
        .filter((p) => p.owner && p.repo);
      const result = { label, prs };
      labeledCache.set(label, result);
      return result;
    },
  );
}
