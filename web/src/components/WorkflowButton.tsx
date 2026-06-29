import type { PrWorkflow, WorkflowRun } from '../lib/workflowTypes.js';

interface Props {
  workflow: PrWorkflow;
  state: WorkflowRun | null;
  onClick: () => void;
}

/** Compact pill rendered per workflow on each matching PR row. Click → run.
 *  Spinner replaces the icon while the workflow is in flight. */
export function WorkflowButton({ workflow, state, onClick }: Props) {
  const running = state?.kind === 'running';
  const success = state?.kind === 'success';
  const failed = state?.kind === 'failed';
  return (
    <button
      type="button"
      className={`workflow-button${running ? ' workflow-button-running' : ''}${success ? ' workflow-button-success' : ''}${failed ? ' workflow-button-failed' : ''}`}
      onClick={(e) => { e.stopPropagation(); if (!running) onClick(); }}
      title={workflow.description ?? workflow.label}
      disabled={running}
      aria-label={`Run workflow: ${workflow.label}`}
    >
      {running ? <span className="loading-spinner workflow-button-spinner" aria-hidden="true" /> : null}
      <span className="workflow-button-label">{workflow.label}</span>
    </button>
  );
}
