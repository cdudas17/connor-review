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
 * Return the URL of the buildkite/zenpayroll check from a status-check-rollup
 * contexts array, regardless of whether it's a StatusContext (typical for Buildkite)
 * or a CheckRun. Returns null if no such check is present.
 */
export function extractBuildkiteZenpayrollUrl(contexts: RollupContextNode[] | undefined | null): string | null {
  if (!Array.isArray(contexts)) return null;
  for (const c of contexts) {
    if (!c) continue;
    if (c.context === 'buildkite/zenpayroll' && c.targetUrl) return c.targetUrl;
    if (c.name === 'buildkite/zenpayroll' && c.detailsUrl) return c.detailsUrl;
  }
  return null;
}
