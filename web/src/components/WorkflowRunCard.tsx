import { renderMarkdown } from '../lib/markdown.js';
import type { WorkflowRun, WorkflowStep } from '../lib/workflowTypes.js';

interface Props {
  workflowLabel: string;
  run: WorkflowRun;
  onDismiss: () => void;
}

function fmtDuration(ms: number | undefined): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function StepBody({ step }: { step: WorkflowStep }) {
  if (step.error) {
    return <pre className="workflow-step-error">{step.error}</pre>;
  }
  if (step.action === 'askClaude') {
    const response = typeof step.output === 'string' ? step.output : '';
    return (
      <div className="workflow-step-claude">
        {step.input && (
          <details className="workflow-step-prompt">
            <summary>prompt</summary>
            <pre>{step.input}</pre>
          </details>
        )}
        {response
          ? <div className="workflow-step-claude-body markdown-body" dangerouslySetInnerHTML={{ __html: renderMarkdown(response) }} />
          : <p className="workflow-step-pending">Asking Claude…</p>}
      </div>
    );
  }
  if (step.action === 'fixCi') {
    const out = step.output as { ok?: boolean; commitSha?: string; filesChanged?: string[]; failingChecksFixed?: string[]; noFailures?: boolean; noChanges?: boolean; code?: string; message?: string } | undefined;
    if (!out) return <p className="workflow-step-pending">Running Fix CI…</p>;
    if (!out.ok) return <pre className="workflow-step-error">{out.code}: {out.message}</pre>;
    if (out.noFailures) return <p className="workflow-step-note">No failing CI checks — nothing for Claude to fix.</p>;
    if (out.noChanges) return <p className="workflow-step-note">Claude inspected the failing checks but made no changes.</p>;
    return (
      <div className="workflow-step-summary">
        <p><strong>Commit:</strong> <code>{out.commitSha?.slice(0, 7)}</code></p>
        {out.filesChanged && out.filesChanged.length > 0 && (
          <p><strong>Files:</strong> {out.filesChanged.join(', ')}</p>
        )}
      </div>
    );
  }
  if (step.action === 'resolveConflicts') {
    const out = step.output as { ok?: boolean; commitSha?: string; trivial?: boolean; code?: string; message?: string } | undefined;
    if (!out) return <p className="workflow-step-pending">Resolving conflicts…</p>;
    if (!out.ok) return <pre className="workflow-step-error">{out.code}: {out.message}</pre>;
    return (
      <div className="workflow-step-summary">
        <p><strong>Commit:</strong> <code>{out.commitSha?.slice(0, 7)}</code>{out.trivial ? ' (trivial)' : ''}</p>
      </div>
    );
  }
  if (step.action === 'resolveThreads') {
    const out = step.output as { ok?: boolean; resolved?: number; matched?: number; authorLogin?: string | null; errors?: Array<{ threadId: string; message: string }>; code?: string; message?: string } | undefined;
    if (!out) return <p className="workflow-step-pending">Resolving threads…</p>;
    if (!out.ok) return <pre className="workflow-step-error">{out.code}: {out.message}</pre>;
    const scope = out.authorLogin ? <>started by <code>{out.authorLogin}</code></> : <>on the PR</>;
    if (out.matched === 0) {
      return <p className="workflow-step-note">No unresolved threads {scope}.</p>;
    }
    return (
      <div className="workflow-step-summary">
        <p>Resolved {out.resolved} of {out.matched} unresolved thread{out.matched === 1 ? '' : 's'} {scope}.</p>
        {out.errors && out.errors.length > 0 && (
          <details>
            <summary>{out.errors.length} error{out.errors.length === 1 ? '' : 's'}</summary>
            <ul>
              {out.errors.map((e) => <li key={e.threadId}><code>{e.threadId}</code>: {e.message}</li>)}
            </ul>
          </details>
        )}
      </div>
    );
  }
  if (step.action === 'updateBranch') {
    const out = step.output as { ok?: boolean; code?: string; message?: string } | undefined;
    if (!out) return <p className="workflow-step-pending">Updating branch…</p>;
    if (!out.ok) return <pre className="workflow-step-error">{out.code}: {out.message}</pre>;
    return <p className="workflow-step-note">Branch updated — base merged into head.</p>;
  }
  if (step.action === 'toast') {
    return <p className={`workflow-step-toast workflow-step-toast-${String(step.output ?? 'info')}`}>{step.input}</p>;
  }
  return null;
}

/** Inline result card rendered in the drawer below the PR description.
 *  Renders the workflow's full step timeline so the user can see what
 *  Claude said / what Fix CI did / where it failed. */
export function WorkflowRunCard({ workflowLabel, run, onDismiss }: Props) {
  return (
    <section className={`workflow-run-card workflow-run-card-${run.kind}`}>
      <header className="workflow-run-card-header">
        <h3>
          <span className="workflow-run-card-label">{workflowLabel}</span>
          <span className="workflow-run-card-status">
            {run.kind === 'running' && <><span className="loading-spinner" aria-hidden="true" /> running</>}
            {run.kind === 'success' && '✓ done'}
            {run.kind === 'failed' && '✗ failed'}
          </span>
        </h3>
        <button type="button" className="workflow-run-card-dismiss" onClick={onDismiss} aria-label="Dismiss workflow result">×</button>
      </header>
      {run.error && <pre className="workflow-step-error">{run.error}</pre>}
      <ol className="workflow-step-list">
        {run.steps.map((step, i) => (
          <li key={i} className={`workflow-step workflow-step-${step.action}${step.finishedAt ? '' : ' workflow-step-running'}`}>
            <div className="workflow-step-header">
              <span className="workflow-step-action">{step.action}</span>
              {step.finishedAt && step.startedAt && (
                <span className="workflow-step-duration">{fmtDuration(step.finishedAt - step.startedAt)}</span>
              )}
              {!step.finishedAt && <span className="loading-spinner workflow-step-spinner" aria-hidden="true" />}
            </div>
            <div className="workflow-step-body">
              <StepBody step={step} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
