import type { FastifyInstance } from 'fastify';

/**
 * Buildkite drill-in. Given a CI check URL like
 *   https://buildkite.com/{org}/{pipeline}/builds/{number}#{job-uuid}
 * pulls the build's annotations (where rspec / jest steps post failure
 * summaries via `buildkite-agent annotate`) and returns them so the CI
 * drawer can render per-test failure details inline.
 *
 * Auth is via the user's local `BUILDKITE_API_TOKEN` env var. Unset → the
 * route returns 503 with a clear "set BUILDKITE_API_TOKEN" message; the
 * drawer surfaces that to the user.
 */

interface ParsedUrl {
  org: string;
  pipeline: string;
  build: string;
  /** Job UUID if the URL was a deep link to a specific job (#<uuid>). */
  jobId: string | null;
}

function parseBuildkiteUrl(url: string): ParsedUrl | null {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith('buildkite.com')) return null;
    // Expected path: /{org}/{pipeline}/builds/{number}
    const parts = u.pathname.split('/').filter(Boolean);
    const buildsIdx = parts.indexOf('builds');
    if (buildsIdx < 2 || !parts[buildsIdx + 1]) return null;
    const org = parts[0];
    const pipeline = parts.slice(1, buildsIdx).join('/');
    const build = parts[buildsIdx + 1];
    // Job UUID lives in the URL hash (e.g. #019089ab-...). Filter out
    // bare anchors like "#step-1" which aren't valid UUIDs.
    const hash = u.hash.replace(/^#/, '');
    const jobId = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(hash) ? hash : null;
    return { org, pipeline, build, jobId };
  } catch {
    return null;
  }
}

interface BuildkiteAnnotation {
  id: string;
  context: string;
  style: 'success' | 'info' | 'warning' | 'error';
  body_html: string;
  created_at: string;
  updated_at: string;
}

interface BuildkiteJob {
  id: string;
  name?: string;
  step_key?: string;
  state?: string;
  exit_status?: number | null;
  web_url?: string;
  log_url?: string;
  /** Set on parallelised jobs — Buildkite groups these by step_key
   *  under the hood but reports each shard as its own job. */
  parallel_group_index?: number | null;
  parallel_group_total?: number | null;
}

interface BuildkiteBuild {
  jobs: BuildkiteJob[];
}

export async function registerBuildkiteRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { url?: string } }>('/api/buildkite/failures', async (req, reply) => {
    const url = req.query.url;
    if (!url) {
      return reply.code(400).send({ code: 'MISSING_URL', message: 'url query param is required' });
    }
    const parsed = parseBuildkiteUrl(url);
    if (!parsed) {
      return reply.code(400).send({ code: 'INVALID_URL', message: 'Could not parse a Buildkite build/job URL.' });
    }
    const token = (process.env.BUILDKITE_API_TOKEN ?? '').trim();
    if (!token) {
      return reply.code(503).send({
        code: 'NO_TOKEN',
        message: 'BUILDKITE_API_TOKEN is not set. Create a Buildkite REST API token (Personal Settings → API Access Tokens, with at least `read_builds` scope) and export it in your shell, then restart the server.',
      });
    }

    const base = `https://api.buildkite.com/v2/organizations/${encodeURIComponent(parsed.org)}/pipelines/${encodeURIComponent(parsed.pipeline)}/builds/${encodeURIComponent(parsed.build)}`;
    const headers = { Authorization: `Bearer ${token}` };

    try {
      // Fetch build + annotations in parallel — the build response gives us
      // job metadata for the focused-job filter, annotations carry the actual
      // failure bodies.
      const [buildRes, annoRes] = await Promise.all([
        fetch(base, { headers }),
        fetch(`${base}/annotations`, { headers }),
      ]);
      if (!buildRes.ok) {
        const txt = (await buildRes.text()).slice(0, 500);
        return reply.code(buildRes.status === 401 ? 401 : 502).send({
          code: buildRes.status === 401 ? 'AUTH_FAILED' : 'BUILDKITE_API_ERROR',
          message: `Buildkite API returned ${buildRes.status}: ${txt}`,
          status: buildRes.status,
        });
      }
      if (!annoRes.ok) {
        const txt = (await annoRes.text()).slice(0, 500);
        return reply.code(502).send({
          code: 'BUILDKITE_API_ERROR',
          message: `Buildkite annotations API returned ${annoRes.status}: ${txt}`,
          status: annoRes.status,
        });
      }

      const build = (await buildRes.json()) as BuildkiteBuild;
      const annotations = (await annoRes.json()) as BuildkiteAnnotation[];

      // Trim annotations to just the failure-flavoured ones — info/success
      // annotations are usually build summaries and not what the user opened
      // the drawer to see. Keep them as fallback only when there are no
      // error/warning ones.
      const errorAnnotations = annotations.filter((a) => a.style === 'error' || a.style === 'warning');
      const surface = errorAnnotations.length > 0 ? errorAnnotations : annotations;

      // If the caller's URL pointed at a specific job (the common case from
      // the CI drawer), surface only that job's metadata; otherwise return
      // all failed jobs so callers can still drill into a specific failure.
      const failedJobs = (build.jobs ?? []).filter((j) => j.state === 'failed' || (typeof j.exit_status === 'number' && j.exit_status !== 0));
      const focusedJob = parsed.jobId ? (build.jobs ?? []).find((j) => j.id === parsed.jobId) ?? null : null;

      // Slim projection of every job in the build so the client can
      // render a Buildkite-style chip grid without needing to hit
      // Buildkite again. Two filters:
      //   1. Actual command jobs — wait/trigger pseudo-jobs (no state,
      //      no id) are structural glue.
      //   2. Non-neutral outcomes only — skipped/broken/canceled jobs
      //      are noise on a review-focused build overview (the user's
      //      screenshot had a wall of grey "–" chips). Keeping just
      //      failed / passed / pending gives the chip grid a signal-
      //      to-noise ratio closer to Buildkite's own "Failures" tab.
      const NEUTRAL_STATES = new Set(['skipped', 'broken', 'canceled', 'canceling', 'neutral']);
      const allJobs = (build.jobs ?? [])
        .filter((j) => j.state != null && j.id != null)
        .filter((j) => !NEUTRAL_STATES.has((j.state ?? '').toLowerCase()))
        .map((j) => ({
          id: j.id,
          name: j.name,
          step_key: j.step_key,
          state: j.state,
          exit_status: j.exit_status ?? null,
          web_url: j.web_url,
          parallel_group_index: j.parallel_group_index ?? null,
          parallel_group_total: j.parallel_group_total ?? null,
        }));

      return {
        org: parsed.org,
        pipeline: parsed.pipeline,
        build: parsed.build,
        buildWebUrl: `https://buildkite.com/${parsed.org}/${parsed.pipeline}/builds/${parsed.build}`,
        focusedJob,
        failedJobs,
        allJobs,
        annotations: surface.map((a) => ({
          id: a.id,
          context: a.context,
          style: a.style,
          body_html: a.body_html,
        })),
      };
    } catch (e) {
      return reply.code(502).send({
        code: 'FETCH_FAILED',
        message: `Failed to reach Buildkite API: ${(e as Error).message}`,
      });
    }
  });

}
