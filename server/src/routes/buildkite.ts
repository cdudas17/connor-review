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
      // Buildkite again. Filter to actual command jobs — wait/trigger
      // pseudo-jobs (no `command` in the API response, no state) are
      // structural glue, not something the user cares about.
      const allJobs = (build.jobs ?? [])
        .filter((j) => j.state != null && j.id != null)
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

  /**
   * Fetch a job's raw log. Companion to `/failures` for the failure-mode
   * where the job posts no annotation — its failure output lives only in
   * the log (rubocop, graphql_score_ratchet, pact-can-i-merge, etc.).
   *
   * `url` should be the job's web URL (e.g. https://.../builds/N#<uuid>)
   * OR a build URL with the `?jobId=<uuid>` query param. Response tail is
   * capped at MAX_TAIL_LINES unless the caller passes `?full=1`.
   *
   * Buildkite embeds a proprietary line-timing prefix (`_bk;t=<ms>`) on
   * every log line so its live log renderer can animate them. We strip
   * that before returning so the tail reads as normal text.
   */
  const MAX_TAIL_LINES = 300;
  app.get<{ Querystring: { url?: string; jobId?: string; full?: string } }>('/api/buildkite/log', async (req, reply) => {
    const url = req.query.url;
    if (!url) {
      return reply.code(400).send({ code: 'MISSING_URL', message: 'url query param is required' });
    }
    const parsed = parseBuildkiteUrl(url);
    if (!parsed) {
      return reply.code(400).send({ code: 'INVALID_URL', message: 'Could not parse a Buildkite build/job URL.' });
    }
    const jobId = (req.query.jobId ?? parsed.jobId ?? '').trim();
    if (!jobId) {
      return reply.code(400).send({
        code: 'MISSING_JOB',
        message: 'A job UUID is required — pass it as the URL fragment (#<uuid>) or via ?jobId=<uuid>.',
      });
    }
    const token = (process.env.BUILDKITE_API_TOKEN ?? '').trim();
    if (!token) {
      return reply.code(503).send({
        code: 'NO_TOKEN',
        message: 'BUILDKITE_API_TOKEN is not set. Add `read_build_logs` scope and export it in your shell, then restart the server.',
      });
    }
    const full = req.query.full === '1';
    const logUrl = `https://api.buildkite.com/v2/organizations/${encodeURIComponent(parsed.org)}/pipelines/${encodeURIComponent(parsed.pipeline)}/builds/${encodeURIComponent(parsed.build)}/jobs/${encodeURIComponent(jobId)}/log.txt`;
    try {
      const res = await fetch(logUrl, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const body = (await res.text()).slice(0, 500);
        const isScope = res.status === 403 && /scope/i.test(body);
        return reply.code(res.status === 401 ? 401 : res.status === 403 ? 403 : 502).send({
          code: isScope ? 'MISSING_SCOPE' : res.status === 401 ? 'AUTH_FAILED' : 'BUILDKITE_API_ERROR',
          message: isScope
            ? "Your BUILDKITE_API_TOKEN doesn't have the `read_build_logs` scope. Edit the token at https://buildkite.com/user/api-access-tokens, enable that scope, export the new value, and restart the server."
            : `Buildkite log API returned ${res.status}: ${body}`,
          status: res.status,
        });
      }
      const raw = await res.text();
      // Strip Buildkite's per-line `_bk;t=<ms>` timing prefix and terminal
      // colour codes so the tail reads like plain text.
      const cleaned = raw
        .replace(/_bk;t=\d+/g, '')
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[0-9;]*m/g, '');
      const allLines = cleaned.split('\n');
      const lines = full ? allLines : allLines.slice(Math.max(0, allLines.length - MAX_TAIL_LINES));
      return {
        jobId,
        buildWebUrl: `https://buildkite.com/${parsed.org}/${parsed.pipeline}/builds/${parsed.build}`,
        totalLines: allLines.length,
        returnedLines: lines.length,
        truncated: !full && lines.length < allLines.length,
        text: lines.join('\n'),
      };
    } catch (e) {
      return reply.code(502).send({
        code: 'FETCH_FAILED',
        message: `Failed to reach Buildkite log API: ${(e as Error).message}`,
      });
    }
  });
}
