import { api, ApiCallError } from './api.js';
import type { PrWorkflow, WorkflowActions, WorkflowPr, WorkflowStep, FixCiOutput, ResolveConflictsOutput, ResolveThreadsOutput } from './workflowTypes.js';
import { extractTags } from './extractTags.js';
import type { PullRequestMeta, TrackedPR } from '../types.js';

/** Per-run interface the runtime uses to feed steps into the
 *  useWorkflowRuns hook. Decoupled so this lib doesn't import the hook
 *  directly. */
export interface WorkflowRunBus {
  appendStep(step: WorkflowStep): number;
  updateStep(idx: number, patch: Partial<WorkflowStep>): void;
  toast(level: 'info' | 'success' | 'error', message: string): void;
}

export interface RunWorkflowDeps {
  /** Look up the local checkout path for a repo name. Workflows that use
   *  `fixCi` / `resolveConflicts` need this — those routes operate on a
   *  local worktree. Returns `null` if no path is configured. */
  resolveRepoPath: (repoName: string) => string | null;
}

/** Whether a workflow's filter matches a PR. Pure — call from the UI to
 *  decide whether to render the button on a row.
 *
 *  Empty `tag` means "apply to every PR" — the CI filter still applies
 *  if set, so an all-PRs workflow can still be scoped to e.g. only
 *  green PRs. */
export function workflowMatches(workflow: PrWorkflow, pr: { title: string; ciStatus: PullRequestMeta['ciStatus'] }): boolean {
  const tag = workflow.tag?.trim();
  if (tag) {
    const tags = extractTags(pr.title);
    if (!tags.includes(tag)) return false;
  }
  const match = workflow.matchCi ?? 'any';
  if (match === 'any') return true;
  if (match === 'failing') return pr.ciStatus === 'FAILURE' || pr.ciStatus === 'ERROR';
  if (match === 'success') return pr.ciStatus === 'SUCCESS';
  if (match === 'pending') return pr.ciStatus === 'PENDING' || pr.ciStatus === 'EXPECTED';
  return true;
}

/** Convert a TrackedPR (the in-memory shape used by the PR list) into the
 *  WorkflowPr surface exposed to user-authored workflows. */
export function prToWorkflowPr(p: TrackedPR): WorkflowPr {
  return {
    owner: p.owner,
    repo: p.repo,
    number: p.number,
    title: p.title ?? '',
    tags: extractTags(p.title ?? ''),
    ciStatus: p.ciStatus ?? null,
    ciCounts: p.ciCounts,
    mergeable: (p.hasConflicts ? 'CONFLICTING' : null),
    url: `https://github.com/${p.owner}/${p.repo}/pull/${p.number}`,
    headRefName: '',  // TrackedPR doesn't carry refs; workflows that need them should askAI with diff context
    baseRefName: '',
  };
}

/** Build the action API + run the workflow. Every action call streams a
 *  step into the bus so the result card can render the live timeline.
 *  Never throws — failures land as the step's `error` field and the
 *  workflow's `failed` state. */
export async function runWorkflow(
  workflow: PrWorkflow,
  pr: WorkflowPr,
  bus: WorkflowRunBus,
  deps: RunWorkflowDeps,
): Promise<void> {
  const actions: WorkflowActions = {
    askAI: async (prompt: string): Promise<string> => {
      const idx = bus.appendStep({ action: 'askAI', input: prompt, startedAt: Date.now() });
      try {
        const repoPath = deps.resolveRepoPath(pr.repo) ?? undefined;
        const { response, tokensUsed } = await api.askAI(pr.owner, pr.repo, pr.number, { draft: prompt, repoPath });
        bus.updateStep(idx, { output: response, finishedAt: Date.now(), tokensUsed });
        return response;
      } catch (e) {
        const message = e instanceof ApiCallError ? e.message : (e as Error).message;
        bus.updateStep(idx, { error: message, finishedAt: Date.now() });
        throw e;
      }
    },

    fixCi: async (): Promise<FixCiOutput> => {
      const idx = bus.appendStep({ action: 'fixCi', startedAt: Date.now() });
      const repoPath = deps.resolveRepoPath(pr.repo);
      if (!repoPath) {
        const message = `Configure localRepos["${pr.repo}"] in config.local.ts to run fixCi`;
        bus.updateStep(idx, { error: message, finishedAt: Date.now() });
        return { ok: false, code: 'NO_LOCAL_REPO', message };
      }
      try {
        const result = await api.fixCi(pr.owner, pr.repo, pr.number, { repoPath });
        let output: FixCiOutput;
        if ('noFailures' in result && result.noFailures) {
          output = { ok: true, noFailures: true };
        } else if ('noChanges' in result && result.noChanges) {
          output = { ok: true, noChanges: true };
        } else if ('commitSha' in result) {
          output = {
            ok: true,
            commitSha: result.commitSha,
            filesChanged: result.filesChanged,
            failingChecksFixed: result.failingChecksFixed,
          };
        } else {
          output = { ok: true, noChanges: true };
        }
        bus.updateStep(idx, { output, finishedAt: Date.now() });
        return output;
      } catch (e) {
        const code = e instanceof ApiCallError ? e.code : 'FIXCI_FAILED';
        const message = e instanceof ApiCallError ? e.message : (e as Error).message;
        const output: FixCiOutput = { ok: false, code, message };
        bus.updateStep(idx, { output, error: message, finishedAt: Date.now() });
        return output;
      }
    },

    resolveThreads: async (opts?: { authorLogin?: string }): Promise<ResolveThreadsOutput> => {
      const authorLogin = opts?.authorLogin;
      const label = authorLogin ? `resolveThreads by ${authorLogin}` : 'resolveThreads (all)';
      const idx = bus.appendStep({ action: 'resolveThreads', input: label, startedAt: Date.now() });
      try {
        const result = await api.resolveThreads(pr.owner, pr.repo, pr.number, { authorLogin });
        const output: ResolveThreadsOutput = {
          ok: true,
          resolved: result.resolved,
          matched: result.matched,
          authorLogin: result.authorLogin,
          errors: result.errors,
        };
        bus.updateStep(idx, { output, finishedAt: Date.now() });
        return output;
      } catch (e) {
        const code = e instanceof ApiCallError ? e.code : 'RESOLVE_THREADS_FAILED';
        const message = e instanceof ApiCallError ? e.message : (e as Error).message;
        const output: ResolveThreadsOutput = { ok: false, code, message };
        bus.updateStep(idx, { output, error: message, finishedAt: Date.now() });
        return output;
      }
    },

    resolveConflicts: async (): Promise<ResolveConflictsOutput> => {
      const idx = bus.appendStep({ action: 'resolveConflicts', startedAt: Date.now() });
      const repoPath = deps.resolveRepoPath(pr.repo);
      if (!repoPath) {
        const message = `Configure localRepos["${pr.repo}"] in config.local.ts to run resolveConflicts`;
        bus.updateStep(idx, { error: message, finishedAt: Date.now() });
        return { ok: false, code: 'NO_LOCAL_REPO', message };
      }
      try {
        const result = await api.resolveConflicts(pr.owner, pr.repo, pr.number, { repoPath });
        const output: ResolveConflictsOutput = { ok: true, commitSha: result.commitSha, trivial: result.trivial };
        bus.updateStep(idx, { output, finishedAt: Date.now() });
        return output;
      } catch (e) {
        const code = e instanceof ApiCallError ? e.code : 'RESOLVE_FAILED';
        const message = e instanceof ApiCallError ? e.message : (e as Error).message;
        const output: ResolveConflictsOutput = { ok: false, code, message };
        bus.updateStep(idx, { output, error: message, finishedAt: Date.now() });
        return output;
      }
    },

    updateBranch: async () => {
      const idx = bus.appendStep({ action: 'updateBranch', startedAt: Date.now() });
      try {
        await api.updateBranch(pr.owner, pr.repo, pr.number);
        const output = { ok: true as const };
        bus.updateStep(idx, { output, finishedAt: Date.now() });
        return output;
      } catch (e) {
        const code = e instanceof ApiCallError ? e.code : 'UPDATE_BRANCH_FAILED';
        const message = e instanceof ApiCallError ? e.message : (e as Error).message;
        const output = { ok: false as const, code, message };
        bus.updateStep(idx, { output, error: message, finishedAt: Date.now() });
        return output;
      }
    },

    toast: (level, message) => {
      bus.appendStep({ action: 'toast', input: message, output: level, startedAt: Date.now(), finishedAt: Date.now() });
      bus.toast(level, message);
    },
  };

  await workflow.run({ pr, actions });
}
