import { useEffect, useState } from 'react';
import { useSkills } from '../hooks/useSkills.js';
import { api } from '../lib/api.js';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Drawer for managing reusable prompt templates ("skills"). Each skill
 * is a markdown file in `~/.connor-review/skills/<slug>.md`. The
 * workflow editor's askAI step can bind to a skill so the prompt
 * lives in one place and every workflow that uses it stays in sync.
 */
export function SkillsManager({ open, onClose }: Props) {
  const skills = useSkills();
  const [selected, setSelected] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // On skill selection, pull the current body (already fetched via the
  // hook's eager pre-fetch, but fetch again as a safety belt for
  // freshly created skills).
  useEffect(() => {
    if (!selected) { setDraftBody(''); return; }
    const cached = skills.bodyFor(selected);
    if (cached !== null) { setDraftBody(cached); return; }
    let cancelled = false;
    api.getSkill(selected).then((s) => { if (!cancelled) setDraftBody(s.body); }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (!open) return null;

  const activeSkill = selected ? skills.skills.find((s) => s.slug === selected) : null;

  const submitCreate = async () => {
    const name = draftName.trim();
    if (!name) { setCreating(false); return; }
    const s = await skills.createSkill(name, '');
    setCreating(false);
    setDraftName('');
    if (s) setSelected(s.slug);
  };

  const saveBody = async () => {
    if (!selected) return;
    setSaveStatus('saving');
    const ok = await skills.updateSkillBody(selected, draftBody);
    setSaveStatus(ok ? 'saved' : 'error');
    if (ok) setTimeout(() => setSaveStatus('idle'), 1200);
  };

  const rename = async () => {
    if (!activeSkill) return;
    const next = window.prompt('Rename skill', activeSkill.name);
    if (next == null) return;
    await skills.renameSkill(activeSkill.slug, next);
  };

  const remove = async () => {
    if (!activeSkill) return;
    if (!confirm(`Delete skill "${activeSkill.name}"?`)) return;
    const ok = await skills.removeSkill(activeSkill.slug);
    if (ok) setSelected(null);
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer skills-manager" aria-label="Manage skills">
        <header className="workflows-manager-header">
          <h2>Skills</h2>
          <button type="button" className="workflows-manager-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="skills-manager-body">
          <nav className="notes-projects" aria-label="Skills">
            <ul className="notes-projects-list">
              {skills.skills.map((s) => (
                <li key={s.slug} className="notes-project-item">
                  <button
                    type="button"
                    className={`notes-project-btn${s.slug === selected ? ' notes-project-btn-active' : ''}`}
                    onClick={() => setSelected(s.slug)}
                    title={s.name}
                  >
                    <span className="notes-project-name">{s.name}</span>
                  </button>
                </li>
              ))}
              <li className="notes-project-new-item">
                {creating ? (
                  <form className="notes-project-new-form" onSubmit={(e) => { e.preventDefault(); void submitCreate(); }}>
                    <input
                      type="text"
                      autoFocus
                      value={draftName}
                      onChange={(e) => setDraftName(e.target.value)}
                      onBlur={submitCreate}
                      placeholder="Skill name"
                      maxLength={48}
                      aria-label="New skill name"
                    />
                  </form>
                ) : (
                  <button type="button" className="notes-project-new" onClick={() => { setCreating(true); setDraftName(''); }}>
                    + New skill
                  </button>
                )}
              </li>
            </ul>
          </nav>
          <div className="skills-manager-editor">
            {activeSkill ? (
              <>
                <header className="notes-panel-header">
                  <h3>{activeSkill.name}</h3>
                  <div className="notes-panel-actions">
                    <button type="button" onClick={rename}>Rename</button>
                    <button type="button" className="notes-panel-delete" onClick={remove}>Delete</button>
                  </div>
                </header>
                <textarea
                  className="skills-editor-textarea"
                  value={draftBody}
                  onChange={(e) => { setDraftBody(e.target.value); setSaveStatus('idle'); }}
                  placeholder="The prompt text. This is what gets sent as the askAI draft when a workflow references this skill."
                />
                <div className="skills-editor-footer">
                  <button
                    type="button"
                    className="workflow-editor-save"
                    onClick={saveBody}
                    disabled={saveStatus === 'saving'}
                  >
                    {saveStatus === 'saving' ? 'Saving…' : 'Save'}
                  </button>
                  {saveStatus === 'saved' && <span className="skills-editor-status">Saved</span>}
                  {saveStatus === 'error' && <span className="skills-editor-status skills-editor-status-error">Save failed</span>}
                  <span className="skills-editor-slug">slug: <code>{activeSkill.slug}</code></span>
                </div>
              </>
            ) : (
              <p className="empty" style={{ padding: 32 }}>
                Pick a skill on the left or create a new one.
                Skills are reusable prompt templates — bind one from a workflow's askAI step
                so the prompt lives in a single place.
              </p>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
