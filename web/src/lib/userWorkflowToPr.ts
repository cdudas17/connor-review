import type { PrWorkflow } from './workflowTypes.js';
import type { UserWorkflow, UserWorkflowStep } from './userWorkflowTypes.js';

/**
 * Convert a declarative `UserWorkflow` (from the in-app editor) into a
 * runnable `PrWorkflow`. The synthesised `run` is a tiny linear
 * interpreter: walks the steps in order, tracks whether the previous
 * step "failed" (action result `ok === false` or askAI threw), and
 * honours each step's `skipIfPrevFailed` / `onlyIfPrevFailed` gate.
 */
export function userWorkflowToPr(uw: UserWorkflow): PrWorkflow {
  return {
    id: `user:${uw.id}`,
    label: uw.label,
    description: uw.description,
    tag: uw.tag,
    matchCi: uw.matchCi,
    run: async ({ actions }) => {
      let prevFailed = false;
      for (const step of uw.steps) {
        const shouldRun = stepShouldRun(step, prevFailed);
        if (!shouldRun) continue;
        try {
          prevFailed = await runStep(step, actions);
        } catch (e) {
          // askAI rejects on transport errors; treat as failed and
          // surface to the user via toast so the timeline isn't silently empty.
          actions.toast('error', `Step failed: ${(e as Error).message}`);
          prevFailed = true;
        }
      }
    },
  };
}

function stepShouldRun(step: UserWorkflowStep, prevFailed: boolean): boolean {
  if (step.action === 'toast') {
    return !step.onlyIfPrevFailed || prevFailed;
  }
  return !step.skipIfPrevFailed || !prevFailed;
}

async function runStep(
  step: UserWorkflowStep,
  actions: Parameters<PrWorkflow['run']>[0]['actions'],
): Promise<boolean /* failed? */> {
  if (step.action === 'askAI') {
    await actions.askAI(step.prompt);
    return false;
  }
  if (step.action === 'fixCi') {
    const r = await actions.fixCi();
    return !r.ok;
  }
  if (step.action === 'resolveConflicts') {
    const r = await actions.resolveConflicts();
    return !r.ok;
  }
  if (step.action === 'resolveThreads') {
    const r = await actions.resolveThreads({ authorLogin: step.authorLogin });
    return !r.ok;
  }
  if (step.action === 'updateBranch') {
    const r = await actions.updateBranch();
    return !r.ok;
  }
  if (step.action === 'toast') {
    actions.toast(step.level, step.message);
    return false;
  }
  return false;
}

/** Slugify a label into a stable id. Used when creating a new workflow
 *  from the editor. */
export function slugifyId(label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base || `workflow-${Date.now()}`;
}
