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
