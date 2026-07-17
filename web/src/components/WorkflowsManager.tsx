import { useEffect, useState } from 'react';
import type { UserWorkflow, UserWorkflowStep } from '../lib/userWorkflowTypes.js';
import type { WorkflowCiMatch } from '../lib/workflowTypes.js';
import { slugifyId } from '../lib/userWorkflowToPr.js';

interface Props {
  open: boolean;
  onClose: () => void;
  workflows: UserWorkflow[];
  onUpsert: (workflow: UserWorkflow) => void;
  onRemove: (id: string) => void;
}

type ActionKind = UserWorkflowStep['action'];

function blankStep(action: ActionKind): UserWorkflowStep {
  if (action === 'askAI') return { action: 'askAI', prompt: '' };
  if (action === 'fixCi') return { action: 'fixCi' };
  if (action === 'resolveConflicts') return { action: 'resolveConflicts' };
  if (action === 'resolveThreads') return { action: 'resolveThreads', authorLogin: '' };
  if (action === 'updateBranch') return { action: 'updateBranch' };
  return { action: 'toast', level: 'info', message: '' };
}

function blankWorkflow(): UserWorkflow {
  const now = Date.now();
  return {
    id: `workflow-${now}`,
    label: '',
    description: '',
    tag: '',
    matchCi: 'any',
    steps: [blankStep('askAI')],
    createdAt: now,
    updatedAt: now,
  };
}

/** Right-side drawer that lists user-defined workflows and lets you
 *  create / edit / delete them inline. Persists via the `onUpsert` /
 *  `onRemove` callbacks the parent passes. Code-authored workflows in
 *  `config.local.ts` aren't surfaced here — they continue to work in
 *  parallel; this drawer only manages the localStorage-backed ones. */
export function WorkflowsManager({ open, onClose, workflows, onUpsert, onRemove }: Props) {
  const [editing, setEditing] = useState<UserWorkflow | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, editing, onClose]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-backdrop" onClick={() => { if (!editing) onClose(); }} aria-hidden="true" />
      <aside className="drawer workflows-manager" aria-label="Manage workflows">
        <header className="workflows-manager-header">
          <h2>Workflows</h2>
          <button type="button" className="workflows-manager-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        {editing ? (
          <WorkflowEditor
            initial={editing}
            existingIds={workflows.map((w) => w.id).filter((id) => id !== editing.id)}
            onSave={(w) => { onUpsert(w); setEditing(null); }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            {workflows.length === 0 ? (
              <p className="empty">No workflows yet — create one below.</p>
            ) : (
              <ul className="workflows-manager-list">
                {workflows.map((w) => (
                  <li key={w.id} className="workflows-manager-item">
                    <div className="workflows-manager-item-body">
                      <strong>{w.label || '(no label)'}</strong>
                      <span className="workflows-manager-item-tag">[{w.tag || '?'}]{w.matchCi && w.matchCi !== 'any' ? ` · ${w.matchCi}` : ''}</span>
                      {w.description && <p className="workflows-manager-item-desc">{w.description}</p>}
                      <p className="workflows-manager-item-steps">{w.steps.length} step{w.steps.length === 1 ? '' : 's'}</p>
                    </div>
                    <div className="workflows-manager-item-actions">
                      <button type="button" onClick={() => setEditing({ ...w })}>Edit</button>
                      <button type="button" onClick={() => { if (confirm(`Delete workflow "${w.label}"?`)) onRemove(w.id); }}>Delete</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="workflows-manager-footer">
              <button type="button" className="workflows-manager-new" onClick={() => setEditing(blankWorkflow())}>+ New workflow</button>
              <p className="workflows-manager-note">
                Workflows defined in <code>config.local.ts</code> work alongside these
                and aren't editable from here.
              </p>
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function WorkflowEditor({ initial, existingIds, onSave, onCancel }: {
  initial: UserWorkflow;
  existingIds: string[];
  onSave: (w: UserWorkflow) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(initial.label);
  const [description, setDescription] = useState(initial.description ?? '');
  const [tag, setTag] = useState(initial.tag);
  const [matchCi, setMatchCi] = useState<WorkflowCiMatch>(initial.matchCi ?? 'any');
  const [steps, setSteps] = useState<UserWorkflowStep[]>(initial.steps.length ? initial.steps : [blankStep('askAI')]);

  const errors: string[] = [];
  if (!label.trim()) errors.push('Label is required.');
  if (!tag.trim()) errors.push('Tag is required.');
  if (steps.length === 0) errors.push('At least one step is required.');
  steps.forEach((s, i) => {
    if (s.action === 'askAI' && !s.prompt.trim()) errors.push(`Step ${i + 1}: prompt is required.`);
    if (s.action === 'toast' && !s.message.trim()) errors.push(`Step ${i + 1}: message is required.`);
  });
  const submit = () => {
    if (errors.length > 0) return;
    const id = initial.id.startsWith('workflow-') ? slugifyId(label) || initial.id : initial.id;
    const finalId = existingIds.includes(id) ? `${id}-${Date.now()}` : id;
    onSave({
      ...initial,
      id: finalId,
      label: label.trim(),
      description: description.trim() || undefined,
      tag: tag.trim(),
      matchCi,
      steps,
      updatedAt: Date.now(),
    });
  };

  const updateStep = (i: number, patch: Partial<UserWorkflowStep>) => {
    setSteps((s) => s.map((step, idx) => idx === i ? ({ ...step, ...patch } as UserWorkflowStep) : step));
  };

  return (
    <div className="workflow-editor">
      <label className="workflow-editor-field">
        <span>Label *</span>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Check loaders" maxLength={32} />
      </label>
      <label className="workflow-editor-field">
        <span>Description</span>
        <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional — shown in the button tooltip" />
      </label>
      <label className="workflow-editor-field">
        <span>Tag *</span>
        <input type="text" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="ID->UUID (no brackets)" />
      </label>
      <label className="workflow-editor-field">
        <span>CI match</span>
        <select value={matchCi} onChange={(e) => setMatchCi(e.target.value as WorkflowCiMatch)}>
          <option value="any">Any</option>
          <option value="success">Green only</option>
          <option value="failing">Red only</option>
          <option value="pending">Pending only</option>
        </select>
      </label>

      <h3>Steps</h3>
      <ol className="workflow-editor-steps">
        {steps.map((step, i) => (
          <li key={i} className="workflow-editor-step">
            <div className="workflow-editor-step-header">
              <select
                value={step.action}
                onChange={(e) => setSteps((s) => s.map((st, idx) => idx === i ? blankStep(e.target.value as ActionKind) : st))}
              >
                <option value="askAI">askAI — run a prompt</option>
                <option value="fixCi">fixCi — Fix failing CI</option>
                <option value="resolveConflicts">resolveConflicts — Claude resolves merge conflicts</option>
                <option value="resolveThreads">resolveThreads — resolve review threads (optionally by author)</option>
                <option value="updateBranch">updateBranch — merge base into PR</option>
                <option value="toast">toast — show a notification</option>
              </select>
              <button type="button" className="workflow-editor-step-remove" onClick={() => setSteps((s) => s.filter((_, idx) => idx !== i))} aria-label="Remove step">×</button>
            </div>
            {step.action === 'askAI' && (
              <textarea
                value={step.prompt}
                onChange={(e) => updateStep(i, { prompt: e.target.value })}
                placeholder="The prompt sent to Claude (with the PR diff as context)."
                rows={4}
              />
            )}
            {step.action === 'resolveThreads' && (
              <input
                type="text"
                value={step.authorLogin ?? ''}
                onChange={(e) => updateStep(i, { authorLogin: e.target.value })}
                placeholder="Author login to filter by (e.g. gusto-fresh-eyes). Blank = all unresolved."
              />
            )}
            {step.action === 'toast' && (
              <>
                <select value={step.level} onChange={(e) => updateStep(i, { level: e.target.value as 'info' | 'success' | 'error' })}>
                  <option value="info">info</option>
                  <option value="success">success</option>
                  <option value="error">error</option>
                </select>
                <input type="text" value={step.message} onChange={(e) => updateStep(i, { message: e.target.value })} placeholder="Notification text" />
              </>
            )}
            {i > 0 && step.action !== 'toast' && (
              <label className="workflow-editor-step-flag">
                <input
                  type="checkbox"
                  checked={!!step.skipIfPrevFailed}
                  onChange={(e) => updateStep(i, { skipIfPrevFailed: e.target.checked })}
                />
                Skip if previous step failed
              </label>
            )}
            {i > 0 && step.action === 'toast' && (
              <label className="workflow-editor-step-flag">
                <input
                  type="checkbox"
                  checked={!!step.onlyIfPrevFailed}
                  onChange={(e) => updateStep(i, { onlyIfPrevFailed: e.target.checked })}
                />
                Only show if previous step failed
              </label>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className="workflow-editor-add-step" onClick={() => setSteps((s) => [...s, blankStep('askAI')])}>+ Add step</button>

      {errors.length > 0 && (
        <ul className="workflow-editor-errors">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}

      <div className="workflow-editor-actions">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="workflow-editor-save" onClick={submit} disabled={errors.length > 0}>Save</button>
      </div>
    </div>
  );
}
