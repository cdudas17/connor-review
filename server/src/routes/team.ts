import type { FastifyInstance } from 'fastify';
import yaml from 'js-yaml';
import { ghExec } from '../lib/ghExec.js';
import { TEAM_PR_SEARCH_QUERY } from '../queries/teamPRs.graphql.js';

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
  baseRefName: string;
  headRefName: string;
  headSha: string;
  updatedAt: string;
}

interface TalentFile {
  github?: {
    members?: string[];
  };
}

async function fetchTalentMembers(repo: string, path: string): Promise<string[]> {
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

async function searchTeamPRs(members: string[]): Promise<TeamPR[]> {
  // is:pr is:open draft:false author:user1 author:user2 ...
  // Multiple author: qualifiers are OR'd by GitHub search.
  const q = ['is:pr', 'is:open', 'draft:false', ...members.map((m) => `author:${m}`)].join(' ');
  const out = await ghExec(['api', 'graphql', '--input', '-'], {
    input: JSON.stringify({ query: TEAM_PR_SEARCH_QUERY, variables: { q } }),
  });
  const parsed = JSON.parse(out) as {
    data?: {
      search?: {
        nodes?: Array<{
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
          updatedAt: string;
          commits?: { nodes?: Array<{ commit?: { statusCheckRollup?: { state?: string } } }> };
        }>;
      };
    };
  };
  const nodes = parsed.data?.search?.nodes ?? [];
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
      baseRefName: n.baseRefName,
      headRefName: n.headRefName,
      headSha: n.headRefOid,
      updatedAt: n.updatedAt,
    }))
    .filter((p) => p.owner && p.repo);
}

export async function registerTeamRoutes(app: FastifyInstance) {
  // Returns the open, non-draft, non-approved PRs authored by members of the given talent.yml.
  // Defaults to Gusto/zenpayroll's config/teams/people_os/talent.yml.
  app.get<{ Querystring: { repo?: string; path?: string } }>(
    '/api/team/prs',
    async (req) => {
      const repo = req.query.repo ?? 'Gusto/zenpayroll';
      const path = req.query.path ?? 'config/teams/people_os/talent.yml';
      const members = await fetchTalentMembers(repo, path);
      const prs = await searchTeamPRs(members);
      return { members, prs };
    },
  );
}
