/**
 * Fire-and-forget telemetry helper for the Fix CI flow. Designed to be the
 * ONLY contact surface between the connor-review server and the standalone
 * `services/fix-ci-telemetry/` app:
 *
 *  - Configured via a single env var (`FIX_CI_TELEMETRY_URL`).
 *  - When the env var is unset, every emit is a no-op — the review app
 *    behaves identically to before the telemetry service existed.
 *  - When set, each emit POSTs JSON to `<url>/events`, bounded to 1 second,
 *    with all errors swallowed. A slow / down / broken telemetry service
 *    cannot block, fail, or even slow down a Fix CI run.
 *
 * The version string below tags every event so the dashboard can compare
 * success rates across prompt revisions. Bump it whenever you ship a new
 * `server/src/prompts/fixCi.vN.ts` file.
 */

/** Bump this when shipping a new prompt version. Should track the filename
 * of the active prompt file (see `server/src/prompts/index.ts`). */
export const FIX_CI_PROMPT_VERSION = 'v3-2026-06-25';

/** Resolved at module load — empty / unset disables emission entirely. */
const TELEMETRY_URL = (process.env.FIX_CI_TELEMETRY_URL ?? '').trim() || null;

/** One-second cap per emit so a hung service can't slow Fix CI down. */
const EMIT_TIMEOUT_MS = 1000;

export type FixCiEventKind = 'started' | 'install_done' | 'claude_done' | 'finished';

/** Fire-and-forget event POST. The caller `await`s for ordering (so events
 * arrive in the same order they're emitted) but the call is bounded by
 * EMIT_TIMEOUT_MS and never throws — telemetry is best-effort. */
export async function emitFixCiEvent(payload: {
  runId: string;
  kind: FixCiEventKind;
  // Any additional payload fields are stored as the row's milestone data.
  [k: string]: unknown;
}): Promise<void> {
  if (!TELEMETRY_URL) return;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), EMIT_TIMEOUT_MS);
  try {
    await fetch(`${TELEMETRY_URL}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, ts: Date.now() }),
      signal: ctrl.signal,
    });
  } catch {
    // Swallow — telemetry is best-effort. Don't log either; a busy run could
    // emit dozens and flood the server logs on every Fix CI invocation.
  } finally {
    clearTimeout(t);
  }
}
