interface Job {
  id: string;
  name?: string;
  step_key?: string;
  state?: string;
  exit_status: number | null;
  web_url?: string;
  parallel_group_index: number | null;
  parallel_group_total: number | null;
}

interface Props {
  jobs: Job[];
  /** Highlighted chip — usually the job the user clicked to enter the
   *  drilldown. Rendered with a stronger outline so it's easy to see
   *  which group's failure detail is showing below. */
  activeStepKey?: string;
}

type Status = 'failure' | 'success' | 'pending' | 'skipped';

function statusOfJob(j: Job): Status {
  const state = (j.state ?? '').toLowerCase();
  if (state === 'failed' || (typeof j.exit_status === 'number' && j.exit_status !== 0)) return 'failure';
  if (state === 'passed') return 'success';
  if (state === 'skipped' || state === 'broken' || state === 'canceled' || state === 'canceling') return 'skipped';
  return 'pending';
}

/** Buildkite groups parallel jobs by step_key under the hood (each
 *  shard is a job in the API response). We collapse them the same way
 *  Buildkite's UI does — one chip per step with an N/M shard count. */
interface Group {
  key: string;
  displayName: string;
  jobs: Job[];
  total: number;
  failed: number;
  passed: number;
  pending: number;
  skipped: number;
  /** Aggregate status for chip colouring. Any failure trumps pending
   *  trumps success. */
  status: Status;
  /** URL for the first failed job (drill target) — otherwise the first
   *  job in the group. Undefined when no job has a web_url. */
  href: string | undefined;
}

function groupJobs(jobs: Job[]): Group[] {
  const byKey = new Map<string, Job[]>();
  for (const j of jobs) {
    // step_key is the stable group identifier; some jobs (script blocks
    // without a key) fall back to the job name.
    const key = j.step_key || j.name || j.id;
    const bucket = byKey.get(key) ?? [];
    bucket.push(j);
    byKey.set(key, bucket);
  }
  return Array.from(byKey.entries()).map(([key, groupJobs]) => {
    let failed = 0, passed = 0, pending = 0, skipped = 0;
    for (const j of groupJobs) {
      const s = statusOfJob(j);
      if (s === 'failure') failed++;
      else if (s === 'success') passed++;
      else if (s === 'skipped') skipped++;
      else pending++;
    }
    const status: Status = failed > 0 ? 'failure' : pending > 0 ? 'pending' : passed > 0 ? 'success' : 'skipped';
    const firstFailed = groupJobs.find((j) => statusOfJob(j) === 'failure');
    const href = firstFailed?.web_url ?? groupJobs[0]?.web_url;
    // Strip leading emoji-shortcode wrapper (":pact: bin/pact-can-i-merge"
    // → "bin/pact-can-i-merge") so the chip label reads cleanly.
    const rawName = groupJobs[0]?.name ?? key;
    const displayName = rawName.replace(/^:\w+:\s*/, '');
    return { key, displayName, jobs: groupJobs, total: groupJobs.length, failed, passed, pending, skipped, status, href };
  }).sort((a, b) => {
    // Failing chips first, then pending, then success, then skipped.
    const order: Status[] = ['failure', 'pending', 'success', 'skipped'];
    const dx = order.indexOf(a.status) - order.indexOf(b.status);
    return dx !== 0 ? dx : a.displayName.localeCompare(b.displayName);
  });
}

/** Buildkite-style compact chip grid summarising every job in a build.
 *  Rendered above the drilldown's failure list / log tail so a failing
 *  job is obvious at a glance and the user has a click-target for
 *  every other job's Buildkite page. */
export function BuildJobChips({ jobs, activeStepKey }: Props) {
  const groups = groupJobs(jobs);
  if (groups.length === 0) return null;
  return (
    <div className="bk-chips" role="list" aria-label="Buildkite jobs">
      {groups.map((g) => {
        // Chip count reads passed/total on green; failed/total on red;
        // running/total on pending.
        const numerator = g.status === 'failure' ? g.failed : g.status === 'pending' ? g.total - g.passed - g.skipped : g.passed;
        const showCount = g.total > 1 || g.status === 'failure';
        const isActive = activeStepKey ? g.key === activeStepKey : false;
        const cls = `bk-chip bk-chip-${g.status}${isActive ? ' bk-chip-active' : ''}`;
        const content = (
          <>
            <span className="bk-chip-icon" aria-hidden="true">
              {g.status === 'failure' ? '✗' : g.status === 'success' ? '✓' : g.status === 'skipped' ? '–' : '●'}
            </span>
            <span className="bk-chip-name">{g.displayName}</span>
            {showCount && <span className="bk-chip-count">{numerator}/{g.total}</span>}
          </>
        );
        return g.href ? (
          <a key={g.key} className={cls} href={g.href} target="_blank" rel="noopener noreferrer" role="listitem">
            {content}
          </a>
        ) : (
          <span key={g.key} className={cls} role="listitem">
            {content}
          </span>
        );
      })}
    </div>
  );
}
