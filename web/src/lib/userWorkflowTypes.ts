import type { WorkflowCiMatch } from './workflowTypes.js';

/**
 * Declarative workflow shape used by the in-app editor. Stored as JSON in
 * localStorage and converted to a runnable `PrWorkflow` at render time
 * (see `userWorkflowToPr.ts`). Less powerful than the TS-authored
 * workflows in `config.local.ts` — no arbitrary code, no inspection of
 * intermediate Claude responses — but editable from a form UI.
 *
 * TS-authored workflows coexist; both lists are merged before being
 * passed to PRList.
 */

export type UserWorkflowStep =
  | { action: 'askClaude'; prompt: string; skipIfPrevFailed?: boolean }
  | { action: 'fixCi'; skipIfPrevFailed?: boolean }
  | { action: 'resolveConflicts'; skipIfPrevFailed?: boolean }
  | { action: 'updateBranch'; skipIfPrevFailed?: boolean }
  | { action: 'toast'; level: 'info' | 'success' | 'error'; message: string; onlyIfPrevFailed?: boolean };

export interface UserWorkflow {
  /** Stable id (auto-generated from label on create). Prefixed `user:` when
   *  converted into a PrWorkflow so it can't collide with code-authored ids. */
  id: string;
  label: string;
  description?: string;
  tag: string;
  matchCi?: WorkflowCiMatch;
  steps: UserWorkflowStep[];
  createdAt: number;
  updatedAt: number;
}
