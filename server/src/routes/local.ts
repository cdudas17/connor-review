import type { FastifyInstance } from 'fastify';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gitExec, GitCliError } from '../lib/gitExec.js';
import { LRUCache } from '../lib/lruCache.js';

const DEFAULT_BASE = 'main';

/** Diff text cache keyed by `<absolutePath>::<headSha>::<base>`. New commits change headSha so this naturally invalidates. */
const diffCache = new LRUCache<string, string>(64);

interface LocalMeta {
  id: string;
  number: number;
  title: string;
  authorLogin: string | null;
  state: 'OPEN';
  merged: false;
  isDraft: false;
  reviewDecision: null;
  ciStatus: null;
  ciUrl: null;
  labels: [];
  assignees: [];
  reviews: [];
  reviewThreads: [];
  createdAt: string | null;
  bodyHtml: string | null;
  viewerPendingReviewId: null;
  baseRefName: string;
  headRefName: string;
  headSha: string;
  url: string;
  /** Discriminator so client code can branch behavior. */
  source: 'local';
  /** The configured repo name (matches what the client passed). */
  localRepo: string;
}

/** Hash a string to a stable positive int (used as a synthetic PR "number"). */
function stableNumber(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function validateRepoPath(path: string | undefined): string {
  if (!path) throw new BadRequest('path query param is required');
  const absolute = resolve(path);
  if (!existsSync(absolute)) throw new BadRequest(`local repo path does not exist: ${absolute}`);
  let stat;
  try {
    stat = statSync(absolute);
  } catch (e) {
    throw new BadRequest(`cannot stat local repo path: ${(e as Error).message}`);
  }
  if (!stat.isDirectory()) throw new BadRequest(`local repo path is not a directory: ${absolute}`);
  const gitDir = resolve(absolute, '.git');
  if (!existsSync(gitDir)) throw new BadRequest(`not a git repo (no .git): ${absolute}`);
  return absolute;
}

class BadRequest extends Error {}

export async function registerLocalRoutes(app: FastifyInstance) {
  // Returns synthetic PR meta describing a local branch. Caller supplies repo path
  // (per-entry from config.local.ts on the web side) plus the branch name.
  app.get<{ Querystring: { repo?: string; path?: string; branch?: string; base?: string } }>(
    '/api/local/meta',
    async (req, reply) => {
      try {
        const repoName = req.query.repo;
        const repoPath = validateRepoPath(req.query.path);
        const branch = req.query.branch;
        const base = req.query.base || DEFAULT_BASE;
        if (!repoName) { reply.code(400).send({ code: 'BAD_PARAMS', message: 'repo query param is required' }); return; }
        if (!branch) { reply.code(400).send({ code: 'BAD_PARAMS', message: 'branch query param is required' }); return; }

        // Resolve head SHA. If this fails, the branch doesn't exist locally.
        let headSha: string;
        try {
          headSha = (await gitExec(['rev-parse', branch], { cwd: repoPath })).trim();
        } catch (e) {
          if (e instanceof GitCliError) {
            reply.code(404).send({ code: 'BRANCH_NOT_FOUND', message: `branch '${branch}' not found in ${repoName}`, stderr: e.stderr });
            return;
          }
          throw e;
        }

        // Latest commit info from the branch tip.
        const [subject, authorName, isoDate] = (await gitExec(
          ['log', '-1', '--pretty=format:%s%n%an%n%aI', branch],
          { cwd: repoPath },
        )).split('\n');

        const meta: LocalMeta = {
          id: `local:${repoName}:${branch}`,
          number: stableNumber(`${repoName}::${branch}`),
          title: subject || branch,
          authorLogin: authorName || null,
          state: 'OPEN',
          merged: false,
          isDraft: false,
          reviewDecision: null,
          ciStatus: null,
          ciUrl: null,
          labels: [],
          assignees: [],
          reviews: [],
          reviewThreads: [],
          createdAt: isoDate || null,
          bodyHtml: null,
          viewerPendingReviewId: null,
          baseRefName: base,
          headRefName: branch,
          headSha,
          url: '',
          source: 'local',
          localRepo: repoName,
        };
        return meta;
      } catch (e) {
        if (e instanceof BadRequest) { reply.code(400).send({ code: 'BAD_PARAMS', message: e.message }); return; }
        throw e;
      }
    },
  );

  // Returns the unified diff for `base...branch`.
  app.get<{ Querystring: { repo?: string; path?: string; branch?: string; base?: string; fresh?: string } }>(
    '/api/local/diff',
    async (req, reply) => {
      try {
        const repoPath = validateRepoPath(req.query.path);
        const branch = req.query.branch;
        const base = req.query.base || DEFAULT_BASE;
        const fresh = req.query.fresh === '1';
        if (!branch) { reply.code(400).send({ code: 'BAD_PARAMS', message: 'branch query param is required' }); return; }

        // Resolve head so the cache key reflects current commit state.
        const headSha = (await gitExec(['rev-parse', branch], { cwd: repoPath })).trim();
        const key = `${repoPath}::${headSha}::${base}`;
        if (!fresh) {
          const cached = diffCache.get(key);
          if (cached !== undefined) {
            reply.type('text/plain; charset=utf-8');
            return cached;
          }
        }
        // --no-color avoids ANSI escapes; ...branch is the "merge-base diff" form so
        // we only show what the branch added on top of base (not what base added since).
        const diff = await gitExec(['diff', '--no-color', `${base}...${branch}`], { cwd: repoPath });
        diffCache.set(key, diff);
        reply.type('text/plain; charset=utf-8');
        return diff;
      } catch (e) {
        if (e instanceof BadRequest) { reply.code(400).send({ code: 'BAD_PARAMS', message: e.message }); return; }
        if (e instanceof GitCliError) {
          reply.code(502).send({ code: 'GIT_FAILED', message: e.message, stderr: e.stderr });
          return;
        }
        throw e;
      }
    },
  );

  // Returns the contents of a file at the given ref. Backs DiffViewer's
  // Expand-context behavior the same way /api/pulls/.../files/content does.
  app.get<{ Querystring: { path?: string; file?: string; ref?: string } }>(
    '/api/local/files/content',
    async (req, reply) => {
      try {
        const repoPath = validateRepoPath(req.query.path);
        const file = req.query.file;
        const ref = req.query.ref;
        if (!file) { reply.code(400).send({ code: 'BAD_PARAMS', message: 'file query param is required' }); return; }
        if (!ref) { reply.code(400).send({ code: 'BAD_PARAMS', message: 'ref query param is required' }); return; }
        const content = await gitExec(['show', `${ref}:${file}`], { cwd: repoPath });
        reply.type('text/plain; charset=utf-8');
        return content;
      } catch (e) {
        if (e instanceof BadRequest) { reply.code(400).send({ code: 'BAD_PARAMS', message: e.message }); return; }
        if (e instanceof GitCliError) {
          // Common case: file doesn't exist at that ref — return 404 so the caller can
          // distinguish "expand had no base content" (new file) from a real error.
          if (/does not exist|exists on disk, but not in|pathspec/i.test(e.stderr)) {
            reply.code(404).send({ code: 'NOT_FOUND', message: 'file not found at ref' });
            return;
          }
          reply.code(502).send({ code: 'GIT_FAILED', message: e.message, stderr: e.stderr });
          return;
        }
        throw e;
      }
    },
  );
}

/** Test-only helper to drop the in-memory diff cache between cases. */
export function __resetLocalRouteCaches(): void {
  diffCache.clear();
}
