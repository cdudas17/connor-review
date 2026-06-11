interface Props {
  state: { kind: 'loading' | 'error' | 'success' } | null;
}

/** Small per-row badge that surfaces this PR's Claude activity in the list:
 * - loading: in-flight ask (spinner)
 * - success: at least one Claude response is saved on this PR
 * - error:   most recent ask failed
 * - null:    no Claude state — nothing renders.
 *
 * Tooltip explains the state. Open the drawer to see the actual response.
 */
export function ClaudeBadge({ state }: Props) {
  if (!state) return null;
  if (state.kind === 'loading') {
    return (
      <span className="claude-badge claude-badge-loading" title="Asking Claude on this PR — answer will land in the drawer">
        <span className="loading-spinner claude-badge-spinner" aria-hidden="true" />
        <span>Claude</span>
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span className="claude-badge claude-badge-error" title="Claude request failed — open the drawer to retry">
        ! Claude
      </span>
    );
  }
  return (
    <span className="claude-badge claude-badge-success" title="Claude has a saved response on this PR — open the drawer to view it">
      ✦ Claude
    </span>
  );
}
