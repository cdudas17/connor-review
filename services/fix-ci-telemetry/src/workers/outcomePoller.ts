/**
 * Outcome poller — every 5 minutes, looks at runs that successfully pushed a
 * commit and asks GitHub what happened next:
 *   - did CI on the new head go green / red / pending?
 *   - did the PR merge?
 *   - did a later commit revert the one we pushed?
 *
 * Auth is whatever `gh` is already logged in as. No SDK / token plumbing.
 */
import type Database from 'better-sqlite3';
import { ghExec, GhCliError } from '../lib/ghExec.js';
import type { RunRow } from '../db.js';

const POLL_INTERVAL_MS = 5 * 60 * 1000;
const MIN_AGE_MS = 10 * 60 * 1000;
const MAX_ROWS_PER_TICK = 25;

interface PullSummary {
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  mergedAt: string | null;
  headRefOid: string;
  commits: { nodes: Array<{ commit: { oid: string } }> };
}

async function fetchPullSummary(owner: string, repo: string, number: number): Promise<PullSummary> {
  const query = `
    query($owner:String!,$repo:String!,$number:Int!){
      repository(owner:$owner,name:$repo){
        pullRequest(number:$number){
          state mergedAt headRefOid
          commits(last:100){ nodes{ commit{ oid } } }
        }
      }
    }`;
  const stdout = await ghExec(
    ['api', 'graphql', '-F', `owner=${owner}`, '-F', `repo=${repo}`, '-F', `number=${number}`, '-f', `query=${query}`],
  );
  const parsed = JSON.parse(stdout) as { data: { repository: { pullRequest: PullSummary } } };
  return parsed.data.repository.pullRequest;
}

async function fetchCiState(owner: string, repo: string, sha: string): Promise<'success' | 'failure' | 'pending' | 'unknown'> {
  try {
    const out = await ghExec(['api', `repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`]);
    const parsed = JSON.parse(out) as { check_runs: Array<{ status: string; conclusion: string | null }> };
    if (!parsed.check_runs?.length) return 'unknown';
    const anyPending = parsed.check_runs.some((r) => r.status !== 'completed');
    if (anyPending) return 'pending';
    const anyFailure = parsed.check_runs.some(
      (r) => r.conclusion && !['success', 'neutral', 'skipped'].includes(r.conclusion),
    );
    return anyFailure ? 'failure' : 'success';
  } catch (e) {
    if (e instanceof GhCliError) return 'unknown';
    throw e;
  }
}

export function startOutcomePoller(db: Database.Database, log: (msg: string) => void): { stop: () => void } {
  const pickRows = db.prepare(`
    SELECT r.*
    FROM runs r
    LEFT JOIN outcomes o ON o.run_id = r.id
    WHERE r.status = 'success_pushed'
      AND r.pushed_sha IS NOT NULL
      AND r.triggered_at <= @cutoff
      AND (o.run_id IS NULL OR o.ci_state = 'pending' OR (o.merged_at IS NULL AND o.reverted = 0))
    ORDER BY r.triggered_at DESC
    LIMIT ${MAX_ROWS_PER_TICK}
  `);

  const upsertOutcome = db.prepare(`
    INSERT INTO outcomes (run_id, observed_at, ci_state, merged_at, reverted, notes)
    VALUES (@run_id, @observed_at, @ci_state, @merged_at, @reverted, @notes)
    ON CONFLICT(run_id) DO UPDATE SET
      observed_at = excluded.observed_at,
      ci_state = excluded.ci_state,
      merged_at = excluded.merged_at,
      reverted = excluded.reverted,
      notes = excluded.notes
  `);

  let stopped = false;

  async function tick(): Promise<void> {
    const rows = pickRows.all({ cutoff: Date.now() - MIN_AGE_MS }) as RunRow[];
    if (!rows.length) return;
    log(`outcome-poller: checking ${rows.length} run${rows.length === 1 ? '' : 's'}`);
    for (const row of rows) {
      if (stopped) return;
      try {
        const pr = await fetchPullSummary(row.owner, row.repo, row.number);
        const shaToCheck = pr.headRefOid || row.pushed_sha!;
        const ciState = await fetchCiState(row.owner, row.repo, shaToCheck);
        const commits = pr.commits?.nodes?.map((n) => n.commit.oid) ?? [];
        const reverted = row.pushed_sha != null && commits.length > 0 && !commits.includes(row.pushed_sha) ? 1 : 0;
        upsertOutcome.run({
          run_id: row.id,
          observed_at: Date.now(),
          ci_state: ciState,
          merged_at: pr.mergedAt ? Date.parse(pr.mergedAt) : null,
          reverted,
          notes: pr.state,
        });
      } catch (e) {
        log(`outcome-poller: ${row.id} failed: ${(e as Error).message}`);
      }
    }
  }

  // Run once on startup so freshly-restored DBs catch up, then on interval.
  void tick();
  const timer = setInterval(() => { void tick(); }, POLL_INTERVAL_MS);

  return {
    stop: () => {
      stopped = true;
      clearInterval(timer);
    },
  };
}
