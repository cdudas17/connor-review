export interface DiffStats {
  /** Total added lines across every file in the diff. */
  additions: number;
  /** Total deleted lines across every file in the diff. */
  deletions: number;
  /** Number of files in the diff. */
  files: number;
}

/**
 * Count additions / deletions / files in a unified diff string. Matches
 * GitHub's "+N -M" surface in the PR header. Pure string scan — cheap enough
 * to call on every render without memoisation, though the drawer memoises
 * anyway since the diff itself is stable.
 *
 * Treats lines starting with `+` as additions (excluding the `+++ b/path`
 * file header), lines starting with `-` as deletions (excluding `--- a/path`),
 * and `diff --git ` as file boundaries.
 */
export function computeDiffStats(diff: string | null | undefined): DiffStats {
  if (!diff) return { additions: 0, deletions: 0, files: 0 };
  let additions = 0;
  let deletions = 0;
  let files = 0;
  // Use a single split — diffs can be huge but we're doing a linear pass.
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) { files++; continue; }
    if (line.startsWith('+++')) continue;
    if (line.startsWith('---')) continue;
    if (line.startsWith('+')) { additions++; continue; }
    if (line.startsWith('-')) { deletions++; continue; }
  }
  return { additions, deletions, files };
}
