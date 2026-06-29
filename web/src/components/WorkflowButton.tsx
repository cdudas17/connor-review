import { useEffect, useState } from 'react';
import type { PrWorkflow, WorkflowRun } from '../lib/workflowTypes.js';

interface Props {
  workflow: PrWorkflow;
  state: WorkflowRun | null;
  onClick: () => void;
}

/** Compact pill rendered per workflow on each matching PR row. Click → run.
 *  Spinner replaces the icon while the workflow is in flight.
 *
 *  Optimistic: flips to the running visual instantly on click instead of
 *  waiting for the parent's state to flow back through props. Without
 *  this, there's a perceptible delay between clicking and the spinner
 *  appearing (setStore → React commit → useEffect updates storeRef →
 *  next render reads the new state). The optimistic flag clears as
 *  soon as a real run state arrives so the success/failed visuals
 *  still take over correctly. */
export function WorkflowButton({ workflow, state, onClick }: Props) {
  const [optimisticRunning, setOptimisticRunning] = useState(false);

  // Clear the optimistic flag once any real run state (running, success,
  // or failed) flows in — at that point we trust the parent.
  useEffect(() => {
    if (state) setOptimisticRunning(false);
  }, [state]);

  const running = optimisticRunning || state?.kind === 'running';
  const success = !running && state?.kind === 'success';
  const failed = !running && state?.kind === 'failed';
  return (
    <button
      type="button"
      className={`workflow-button${running ? ' workflow-button-running' : ''}${success ? ' workflow-button-success' : ''}${failed ? ' workflow-button-failed' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        if (running) return;
        setOptimisticRunning(true);
        onClick();
      }}
      title={workflow.description ?? workflow.label}
      disabled={running}
      aria-label={`Run workflow: ${workflow.label}`}
    >
      {running ? <span className="loading-spinner workflow-button-spinner" aria-hidden="true" /> : null}
      <span className="workflow-button-label">{workflow.label}</span>
    </button>
  );
}
