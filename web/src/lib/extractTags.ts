/**
 * Pull the leading bracket-tags out of a PR title.
 *
 * Examples:
 *   "[ID->UUID] Rename ..."                 → ["ID->UUID"]
 *   "[ATM-SYNC][FF-ON] Enable ..."          → ["ATM-SYNC", "FF-ON"]
 *   "Plain title with no tags"              → []
 *   "  [FOO]  [BAR] body"                    → ["FOO", "BAR"]
 *
 * Tags must be contiguous at the start of the title. A bracket later in the
 * title (e.g. "WIP: rename [Foo] bar") is NOT treated as a tag — that's body
 * content, not the user's tagging convention.
 */
export function extractTags(title: string | null | undefined): string[] {
  if (!title) return [];
  const tags: string[] = [];
  let s = title.trimStart();
  while (s.startsWith('[')) {
    const end = s.indexOf(']');
    if (end < 0) break;
    const tag = s.slice(1, end).trim();
    if (tag.length === 0) break;
    tags.push(tag);
    s = s.slice(end + 1).trimStart();
  }
  return tags;
}

/** Sentinel tag used for PRs whose title has no leading bracket-tags. Renders
 * as "[ANY]" on the dashboard. Keeps the OR-filter logic uniform — every PR
 * has at least one effective tag. */
export const ANY_TAG = 'ANY';

export function effectiveTags(title: string | null | undefined): string[] {
  const tags = extractTags(title);
  return tags.length > 0 ? tags : [ANY_TAG];
}
