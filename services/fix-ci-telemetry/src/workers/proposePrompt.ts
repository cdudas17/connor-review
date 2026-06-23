/**
 * Propose-prompt worker — once a day, clusters the last 7 days of Fix CI
 * runs that are interesting (failures + slow successes) and asks Claude to
 * draft a revised prompt for each cluster. Drafts land in
 * `prompt_suggestions` for manual review on the dashboard.
 *
 * Two failure modes drive suggestions:
 *  - Effectiveness — runs that hit `safety_aborted`, `push_failed`,
 *    `install_failed`. Prompt should steer Claude away from these.
 *  - Latency — runs that succeeded (`success_pushed` / `success_rebased`)
 *    but ran past SLOW_RUN_THRESHOLD_MS. Prompt should keep the fix
 *    quality but cut wall-clock.
 *
 * `claude_failed` is deliberately excluded — that's a CLI crash, the
 * prompt couldn't have influenced it.
 *
 * Low-precision assistant: doesn't A/B test, doesn't auto-ship. Just keeps
 * a list of "here's what's been costing us, here's a draft to consider".
 */
import type Database from 'better-sqlite3';
import { claudeExec, ClaudeCliError } from '../lib/claudeExec.js';
import type { RunRow } from '../db.js';

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_CLUSTER_SIZE = 3;
const MAX_EXAMPLES = 5;
/** Successful runs taking longer than this are clustered as a latency
 * concern. 15 min picks up runs where Claude over-investigated or the
 * full test suite was invoked, while leaving genuinely large fixes alone. */
const SLOW_RUN_THRESHOLD_MS = 15 * 60 * 1000;

interface Cluster {
  status: string;
  abort_code: string | null;
  runs: RunRow[];
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '?';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function isSlowSuccess(r: RunRow): boolean {
  if (r.status !== 'success_pushed' && r.status !== 'success_rebased') return false;
  return (r.total_ms ?? 0) >= SLOW_RUN_THRESHOLD_MS;
}

function clusterRuns(rows: RunRow[]): Cluster[] {
  const by = new Map<string, Cluster>();
  for (const r of rows) {
    // Slow successes share `status` with fast successes (which the query
    // already excludes), so tag them with a synthetic 'SLOW' abort_code.
    // That keeps the dashboard's cluster summary unambiguous and lets
    // buildMetaPrompt branch on it.
    const abortCode = isSlowSuccess(r) ? 'SLOW' : r.abort_code;
    const key = `${r.status}::${abortCode ?? ''}`;
    let c = by.get(key);
    if (!c) {
      c = { status: r.status, abort_code: abortCode, runs: [] };
      by.set(key, c);
    }
    c.runs.push(r);
  }
  return Array.from(by.values()).filter((c) => c.runs.length >= MIN_CLUSTER_SIZE);
}

function buildExample(r: RunRow): string {
  const failing = r.failing_checks ? JSON.parse(r.failing_checks) as Array<{ name: string }> : [];
  const failingNames = failing.map((c) => c.name).join(', ') || '(none recorded)';
  const tail = (r.stderr_tail ?? r.error ?? '(no stderr captured)').slice(-800);
  const filesChanged = r.files_changed ? (JSON.parse(r.files_changed) as string[]) : [];
  const timing = `total=${fmtMs(r.total_ms)} install=${fmtMs(r.install_ms)} claude=${fmtMs(r.claude_ms)}`;
  const filesLine = filesChanged.length
    ? `\n    files changed: ${filesChanged.slice(0, 10).join(', ')}${filesChanged.length > 10 ? ` …(+${filesChanged.length - 10})` : ''}`
    : '';
  return `- Run ${r.id} (${r.owner}/${r.repo}#${r.number}, version=${r.prompt_version ?? 'unknown'}):\n    failing: ${failingNames}\n    timing: ${timing}${filesLine}\n    stderr_tail: ${tail.replace(/\n/g, '\n      ')}`;
}

function buildMetaPrompt(currentPrompt: string, cluster: Cluster): string {
  const examples = cluster.runs.slice(0, MAX_EXAMPLES).map(buildExample).join('\n\n');
  const isLatencyCluster = cluster.abort_code === 'SLOW';

  if (isLatencyCluster) {
    return [
      `You are reviewing a "Fix CI" agent prompt and proposing a revised version that completes faster.`,
      ``,
      `The current prompt (which Claude is given when the user clicks "Fix CI"):`,
      `---`,
      currentPrompt,
      `---`,
      ``,
      `In the last 7 days, the following Fix CI runs succeeded (a fix was pushed and CI was happy)`,
      `but the wall-clock was longer than ${SLOW_RUN_THRESHOLD_MS / 60_000} minutes. We want the prompt`,
      `to keep its effectiveness while reducing the time spent. The timing breakdown is shown for`,
      `each run (install_ms is dependency install BEFORE Claude runs — only the prompt can affect`,
      `claude_ms).`,
      ``,
      examples,
      ``,
      `Propose a revised prompt that would have produced the same fixes faster. Likely levers:`,
      `- If claude_ms dominates, the prompt may be encouraging over-investigation. Tighten the`,
      `  "investigate ONLY the failing test(s)" guidance, add explicit "don't re-run the full`,
      `  suite" rules, or set a per-test timeout.`,
      `- If files changed is a long list, the fix may be touching more than needed. Add stronger`,
      `  "narrowest fix that makes the failing test pass" framing.`,
      `- Keep the original structure and tone. Minimize edits. Output ONLY the revised prompt`,
      `  body — no commentary, no diff, no markdown fences. The body replaces the current prompt`,
      `  verbatim.`,
    ].join('\n');
  }

  return [
    `You are reviewing a "Fix CI" agent prompt and proposing a revised version.`,
    ``,
    `The current prompt (which Claude is given when the user clicks "Fix CI"):`,
    `---`,
    currentPrompt,
    `---`,
    ``,
    `In the last 7 days, the following runs failed with status="${cluster.status}"` +
      (cluster.abort_code ? ` and abort_code="${cluster.abort_code}"` : '') + `:`,
    ``,
    examples,
    ``,
    `Propose a revised prompt that would have steered Claude away from these failures.`,
    `Keep the original structure and tone. Minimize edits. Output ONLY the revised prompt body —`,
    `no commentary, no diff, no markdown fences. The body will replace the current prompt verbatim.`,
  ].join('\n');
}

function currentPromptText(): string {
  // We don't import the prompt file across packages (kept independent). The
  // worker holds a textual summary; in practice the suggestion is a
  // starting point reviewed against the actual file in the editor.
  return [
    'You are fixing failing CI builds for a PR.',
    'Investigate failing tests / linters / type checks, reproduce locally,',
    'edit source files to make them pass, do not touch lockfiles, do not run',
    'git, do not enable interactive/watch modes, and stop instead of writing',
    'unrelated code if the fix requires broader refactoring.',
  ].join('\n');
}

export async function runProposePromptOnce(
  db: Database.Database,
  log: (msg: string) => void,
): Promise<number> {
  const since = Date.now() - WINDOW_MS;
  // Two eligible buckets:
  //  1. Failures we want to steer away from (excluding claude_failed —
  //     that's a CLI crash, not a prompt issue).
  //  2. Slow successes — fixes that worked but took too long.
  const rows = db.prepare(`
    SELECT * FROM runs
    WHERE triggered_at >= ?
      AND (
        status IN ('safety_aborted', 'push_failed', 'install_failed')
        OR (status IN ('success_pushed', 'success_rebased') AND total_ms IS NOT NULL AND total_ms >= ?)
      )
  `).all(since, SLOW_RUN_THRESHOLD_MS) as RunRow[];
  const clusters = clusterRuns(rows);
  if (!clusters.length) {
    log(`propose-prompt: no clusters of size >= ${MIN_CLUSTER_SIZE} in the last 7 days`);
    return 0;
  }
  const insert = db.prepare(`
    INSERT INTO prompt_suggestions (created_at, cluster_summary, failing_runs, current_prompt, proposed_prompt, shipped)
    VALUES (@created_at, @cluster_summary, @failing_runs, @current_prompt, @proposed_prompt, 0)
  `);
  let created = 0;
  for (const cluster of clusters) {
    const summary = `${cluster.runs.length} runs · status=${cluster.status}${cluster.abort_code ? ` · ${cluster.abort_code}` : ''}`;
    const current = currentPromptText();
    try {
      const proposed = await claudeExec(buildMetaPrompt(current, cluster), {
        timeoutMs: 5 * 60_000,
        allowedTools: ['Read'],
        permissionMode: 'acceptEdits',
      });
      insert.run({
        created_at: Date.now(),
        cluster_summary: summary,
        failing_runs: JSON.stringify(cluster.runs.map((r) => r.id)),
        current_prompt: current,
        proposed_prompt: proposed.trim(),
      });
      created++;
      log(`propose-prompt: wrote suggestion for "${summary}"`);
    } catch (e) {
      if (e instanceof ClaudeCliError) {
        log(`propose-prompt: claude failed for "${summary}": ${e.message}`);
      } else {
        log(`propose-prompt: unexpected failure for "${summary}": ${(e as Error).message}`);
      }
    }
  }
  return created;
}

export function startProposePromptDaily(db: Database.Database, log: (msg: string) => void): { stop: () => void } {
  let stopped = false;
  async function tick(): Promise<void> {
    if (stopped) return;
    try { await runProposePromptOnce(db, log); }
    catch (e) { log(`propose-prompt: tick failed: ${(e as Error).message}`); }
  }
  const timer = setInterval(() => { void tick(); }, RUN_INTERVAL_MS);
  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}

// `npm run worker:propose -- --once` runs a single pass manually (handy
// during development / when you want to seed suggestions immediately).
if (process.argv.includes('--once')) {
  const { openDb } = await import('../db.js');
  const db = openDb();
  const log = (msg: string) => console.log(`[propose-prompt] ${msg}`);
  const n = await runProposePromptOnce(db, log);
  log(`done: ${n} suggestions written`);
  db.close();
}
