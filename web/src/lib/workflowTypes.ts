import type { CiStatus } from '../types.js';

/**
 * Tag-driven Claude workflows on the My PRs tab. Users author these in
 * `config.local.ts` (typed via this file). A workflow is just an async TS
 * function that receives a PR + an action API and chains as many
 * Claude / Fix-CI / rebase / toast calls as it wants.
 *
 * v1 only runs on manual button click; auto-fire on tag+state match is
 * out of scope but the state hook captures `lastFiredAt` per
 * (workflowId, prKey) so it can layer in cleanly later.
 */

/** Coarse-grained CI status filter. Maps to PullRequestMeta.ciStatus. */
export type WorkflowCiMatch = 'failing' | 'success' | 'pending' | 'any';

export interface PrWorkflow {
  /** Stable id used to key per-PR state in localStorage. Don't change
   *  it after shipping a workflow you've run, or the state resets. */
  id: string;
  /** Short label rendered on the row's run button. ≤ ~16 chars. */
  label: string;
  /** Optional longer description used as the button's hover tooltip. */
  description?: string;
  /** Bracket-tag (case-sensitive, no `[`/`]`) that gates the workflow.
   *  When set, the workflow is only offered on rows whose title contains
   *  this tag. Leave empty ('') to apply the workflow to every PR on
   *  the My PRs tab (still subject to `matchCi` if set). */
  tag: string;
  /** Optional CI-status filter — workflow is hidden on rows that don't
   *  match. Default `'any'`. */
  matchCi?: WorkflowCiMatch;
  /** The function that runs when the user clicks the button. Receives a
   *  context with PR metadata + an action API; can chain any number of
   *  awaits and branch on intermediate results. */
  run: (ctx: WorkflowContext) => Promise<void>;
}

export interface WorkflowPr {
  owner: string;
  repo: string;
  number: number;
  title: string;
  tags: string[];
  ciStatus: CiStatus;
  ciCounts?: { passed: number; total: number };
  mergeable: 'CONFLICTING' | 'MERGEABLE' | 'UNKNOWN' | null;
  url: string;
  headRefName: string;
  baseRefName: string;
}

export type FixCiOutput =
  | { ok: true; commitSha: string; filesChanged: string[]; failingChecksFixed: string[] }
  | { ok: true; noFailures: true }
  | { ok: true; noChanges: true }
  | { ok: false; code: string; message: string };

export type ResolveConflictsOutput =
  | { ok: true; commitSha: string; trivial?: boolean }
  | { ok: false; code: string; message: string };

export type ResolveThreadsOutput =
  | { ok: true; resolved: number; matched: number; authorLogin: string | null; errors: Array<{ threadId: string; message: string }> }
  | { ok: false; code: string; message: string };

export interface WorkflowActions {
  /** Run an arbitrary Claude prompt with the PR diff as context. Returns
   *  Claude's response string. Backed by POST /api/pulls/.../ai/ask. */
  askAI(prompt: string): Promise<string>;
  /** Spin up a worktree + run Fix CI. Result includes the rebase-when-
   *  unrelated path. Resolves with a result object — never throws on
   *  HTTP errors; failures land in `{ ok: false, code, message }`. */
  fixCi(): Promise<FixCiOutput>;
  /** Resolve merge conflicts via Claude. Same not-throwing convention. */
  resolveConflicts(): Promise<ResolveConflictsOutput>;
  /** Bulk-resolve review threads on the PR via GitHub's resolveReviewThread
   *  mutation. Pass `authorLogin` (e.g. 'gusto-fresh-eyes') to restrict to
   *  threads started by that account; omit to resolve every unresolved
   *  thread. Same not-throwing convention — HTTP errors land as
   *  `{ ok: false, code, message }`. */
  resolveThreads(opts?: { authorLogin?: string }): Promise<ResolveThreadsOutput>;
  /** Equivalent to GitHub's "Update branch" button. Merges base→head on
   *  the PR via `gh api repos/:o/:r/pulls/:n/update-branch -X POST`. */
  updateBranch(): Promise<{ ok: true } | { ok: false; code: string; message: string }>;
  /** Surface a toast to the user. */
  toast(level: 'info' | 'success' | 'error', message: string): void;
}

export interface WorkflowContext {
  pr: WorkflowPr;
  actions: WorkflowActions;
}

/** One step of a workflow run — what action fired, when, with what
 *  input + output. Stored on the run so the result card can replay the
 *  whole timeline (including across page reloads). */
export type WorkflowStepAction = 'askAI' | 'fixCi' | 'resolveConflicts' | 'resolveThreads' | 'updateBranch' | 'toast';

export interface WorkflowStep {
  action: WorkflowStepAction;
  /** Action-input summary (e.g. the prompt text for askAI). */
  input?: string;
  /** Action-output. Shape depends on the action — JSON-serialisable so
   *  the step survives a localStorage round-trip. */
  output?: unknown;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  /** Tokens the model reported for this step. Populated for askAI
   *  from Codex's stderr summary; undefined for non-LLM actions
   *  (fixCi/resolveConflicts/etc.). */
  tokensUsed?: number;
}

export type WorkflowRunKind = 'running' | 'success' | 'failed';

export interface WorkflowRun {
  workflowId: string;
  /** `owner/repo#number` */
  prKey: string;
  kind: WorkflowRunKind;
  startedAt: number;
  finishedAt?: number;
  steps: WorkflowStep[];
  /** Top-level error (e.g. an uncaught throw in the workflow function). */
  error?: string;
  /** Stamp of the last time this workflow was invoked against this PR.
   *  Used today for de-dupe + dismissal; v2 auto-fire reads it to skip
   *  PRs we've already touched recently. */
  lastFiredAt: number;
}
