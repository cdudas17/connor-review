/**
 * Propose-prompt worker — once a day, clusters the last 7 days of failed runs
 * by `(status, abort_code)` and asks Claude to draft a revised Fix CI prompt
 * given a handful of representative failures. Drafts land in
 * `prompt_suggestions` for manual review on the dashboard.
 *
 * This is intentionally a low-precision assistant: it doesn't A/B test, it
 * doesn't auto-ship. It just keeps a list of "here's what's been failing,
 * here's a draft to consider".
 */
import type Database from 'better-sqlite3';
import { claudeExec, ClaudeCliError } from '../lib/claudeExec.js';
import type { RunRow } from '../db.js';

const RUN_INTERVAL_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_CLUSTER_SIZE = 3;
const MAX_EXAMPLES = 5;

interface Cluster {
  status: string;
  abort_code: string | null;
  runs: RunRow[];
}

function clusterFailures(rows: RunRow[]): Cluster[] {
  const by = new Map<string, Cluster>();
  for (const r of rows) {
    const key = `${r.status}::${r.abort_code ?? ''}`;
    let c = by.get(key);
    if (!c) {
      c = { status: r.status, abort_code: r.abort_code, runs: [] };
      by.set(key, c);
    }
    c.runs.push(r);
  }
  return Array.from(by.values()).filter((c) => c.runs.length >= MIN_CLUSTER_SIZE);
}

function buildMetaPrompt(currentPrompt: string, cluster: Cluster): string {
  const examples = cluster.runs.slice(0, MAX_EXAMPLES).map((r) => {
    const failing = r.failing_checks ? JSON.parse(r.failing_checks) as Array<{ name: string }> : [];
    const failingNames = failing.map((c) => c.name).join(', ') || '(none recorded)';
    const tail = (r.stderr_tail ?? r.error ?? '(no stderr captured)').slice(-800);
    return `- Run ${r.id} (${r.owner}/${r.repo}#${r.number}, version=${r.prompt_version ?? 'unknown'}):\n    failing: ${failingNames}\n    stderr_tail: ${tail.replace(/\n/g, '\n      ')}`;
  }).join('\n\n');
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
  // worker holds a textual summary of v1; in practice the suggestion is a
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
  const rows = db.prepare(`
    SELECT * FROM runs
    WHERE triggered_at >= ?
      AND status IN ('claude_failed', 'safety_aborted', 'push_failed', 'install_failed')
  `).all(since) as RunRow[];
  const clusters = clusterFailures(rows);
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
