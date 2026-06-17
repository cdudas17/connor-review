interface RollupContextNode {
  __typename?: string;
  // StatusContext fields
  context?: string;
  state?: string;
  targetUrl?: string | null;
  // CheckRun fields
  name?: string;
  status?: string;
  conclusion?: string | null;
  detailsUrl?: string | null;
}

/**
 * Return the URL of the first `buildkite/*` check found in a status-check-rollup
 * contexts array, regardless of whether GitHub serialized it as a StatusContext
 * (typical for the Buildkite GitHub app) or a CheckRun. Returns null when no
 * Buildkite check is present.
 */
export function extractBuildkiteCheckUrl(contexts: RollupContextNode[] | undefined | null): string | null {
  if (!Array.isArray(contexts)) return null;
  for (const c of contexts) {
    if (!c) continue;
    // Match any "buildkite/..." check so this works for any repo/pipeline.
    if (c.context?.startsWith('buildkite/') && c.targetUrl) return c.targetUrl;
    if (c.name?.startsWith('buildkite/') && c.detailsUrl) return c.detailsUrl;
  }
  return null;
}

/**
 * Flatten the heterogeneous rollup contexts array (CheckRun OR StatusContext)
 * into a uniform shape. Used by the "Fix failing CI" flow to give Claude a
 * list of failing checks. `isFailure` is true for any state we'd visually
 * flag as red: FAILURE / ERROR / CANCELLED / TIMED_OUT / ACTION_REQUIRED.
 */
export function flattenCiContexts(
  contexts: RollupContextNode[] | undefined | null,
): Array<{ name: string; state: string | null; url: string | null; isFailure: boolean }> {
  if (!Array.isArray(contexts)) return [];
  return contexts.map((c) => {
    const isCheckRun = c?.__typename === 'CheckRun';
    if (isCheckRun) {
      // For check runs, "conclusion" is the terminal state; "status" tells
      // us whether the check is still in progress. We surface conclusion when
      // the check is done, status otherwise.
      const concluded = c.status === 'COMPLETED';
      const state = concluded ? (c.conclusion ?? null) : (c.status ?? null);
      return {
        name: c.name ?? '',
        state,
        url: c.detailsUrl ?? null,
        isFailure: concluded && (
          state === 'FAILURE' ||
          state === 'ACTION_REQUIRED' ||
          state === 'CANCELLED' ||
          state === 'TIMED_OUT' ||
          state === 'STARTUP_FAILURE'
        ),
      };
    }
    return {
      name: c?.context ?? '',
      state: c?.state ?? null,
      url: c?.targetUrl ?? null,
      isFailure: c?.state === 'FAILURE' || c?.state === 'ERROR',
    };
  }).filter((x) => x.name);
}

/** Counts of passing vs total CI contexts on the rollup. Matches GitHub's
 * "9 of 10 successful" surface — passed includes SUCCESS / NEUTRAL / SKIPPED
 * (a "successful" terminal state from the user's POV); total counts every
 * context regardless of state so still-running pipelines also raise the
 * denominator. */
export function countCiContexts(
  contexts: RollupContextNode[] | undefined | null,
): { passed: number; total: number } {
  if (!Array.isArray(contexts)) return { passed: 0, total: 0 };
  let passed = 0;
  let total = 0;
  for (const c of contexts) {
    if (!c) continue;
    if (c.__typename === 'CheckRun') {
      total++;
      // Treat pending/in-progress as "not yet passed". Once COMPLETED we look
      // at conclusion — SUCCESS / NEUTRAL / SKIPPED count as passing.
      if (c.status === 'COMPLETED' && (
        c.conclusion === 'SUCCESS' ||
        c.conclusion === 'NEUTRAL' ||
        c.conclusion === 'SKIPPED'
      )) {
        passed++;
      }
    } else if (c.__typename === 'StatusContext') {
      total++;
      if (c.state === 'SUCCESS') passed++;
    }
  }
  return { passed, total };
}

/**
 * Detect whether this PR has an active Trunk merge-queue check run. Trunk's
 * GitHub app posts a check whose name starts with "Trunk" (typically
 * "Trunk Merge") and stays in QUEUED / IN_PROGRESS while the PR is parked in
 * Trunk's merge queue. Falls back to the legacy StatusContext shape just in
 * case Trunk's integration ever uses that surface.
 *
 * Returns false for repos that don't use Trunk (no such check exists), so
 * callers can call this unconditionally regardless of repo.
 */
export function detectTrunkInQueue(contexts: RollupContextNode[] | undefined | null): boolean {
  if (!Array.isArray(contexts)) return false;
  for (const c of contexts) {
    if (!c) continue;
    if (c.__typename === 'CheckRun') {
      const name = c.name ?? '';
      if (!/^trunk/i.test(name)) continue;
      if (c.status === 'QUEUED' || c.status === 'IN_PROGRESS') return true;
    } else if (c.__typename === 'StatusContext') {
      const name = c.context ?? '';
      if (!/^trunk/i.test(name)) continue;
      if (c.state === 'PENDING') return true;
    }
  }
  return false;
}
