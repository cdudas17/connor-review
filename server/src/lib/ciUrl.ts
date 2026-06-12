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
