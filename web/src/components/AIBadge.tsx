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
export function AIBadge({ state }: Props) {
  if (!state) return null;
  if (state.kind === 'loading') {
    return (
      <span
        className="claude-badge claude-badge-loading has-tooltip"
        data-tooltip="Asking Claude on this PR — answer will land in the drawer"
        aria-label="Asking Claude"
      >
        <span className="loading-spinner claude-badge-spinner" aria-hidden="true" />
      </span>
    );
  }
  if (state.kind === 'error') {
    return (
      <span
        className="claude-badge claude-badge-error has-tooltip"
        data-tooltip="Claude request failed — open the drawer to retry"
        aria-label="Claude request failed"
      >
        !
      </span>
    );
  }
  return (
    <span
      className="claude-badge claude-badge-success has-tooltip"
      data-tooltip="Claude has a saved response on this PR — open the drawer to view it"
      aria-label="Claude has a saved response"
    >
      ✦
    </span>
  );
}
