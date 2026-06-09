import { api } from './api.js';
import { APP_CONFIG } from '../config.js';

/**
 * If `APP_CONFIG.autoLabelOnReview` has a rule for `authorLogin`, post the
 * configured labels to the PR. Best-effort: this never throws — failures are
 * reported via the provided `onToast` (or silently swallowed if no callback).
 *
 * Skipped entirely when `authorLogin` is null/empty, when there's no rule for
 * the author, or when the rule's label array is empty. Idempotent at the
 * GitHub layer (POST .../labels is a no-op for already-present labels).
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
    await api.addLabels(target.owner, target.repo, target.number, labels);
  } catch (e) {
    // Best-effort: don't let a failed label add cascade into the user's review flow.
    opts?.onToast?.('error', `Couldn't apply auto-label (${labels.join(', ')}): ${(e as Error).message}`);
  }
}
