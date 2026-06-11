import { api } from './api.js';
import { APP_CONFIG } from '../config.js';

/**
 * If `APP_CONFIG.autoLabelOnReview` has a rule for `authorLogin`, SET the PR's
 * label list to exactly the configured labels — i.e. drop every other label
 * that was on the PR. Used to keep flagged-author PRs visibly marked with only
 * our reviewer tag (no "needs-review", no automation labels, etc.).
 *
 * Best-effort: this never throws — failures are reported via the provided
 * `onToast` (or silently swallowed if no callback).
 *
 * Skipped entirely when `authorLogin` is null/empty, when there's no rule for
 * the author, or when the rule's label array is empty.
 */
export async function maybeAutoLabelOnReview(
  target: { owner: string; repo: string; number: number },
  authorLogin: string | null | undefined,
  opts?: { onToast?: (kind: 'info' | 'error', message: string) => void },
): Promise<void> {
  if (!authorLogin) return;
  const labels = APP_CONFIG.autoLabelOnReview?.[authorLogin];
  if (!labels || labels.length === 0) return;
  try {
    // Use replace mode so any pre-existing labels (other than ours) are dropped.
    // For authors not in the config, this helper never runs — they're unaffected.
    await api.addLabels(target.owner, target.repo, target.number, labels, { mode: 'replace' });
  } catch (e) {
    opts?.onToast?.('error', `Couldn't apply auto-label (${labels.join(', ')}): ${(e as Error).message}`);
  }
}
