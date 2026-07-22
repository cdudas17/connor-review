import { useEffect, useRef, useState } from 'react';
import { useNoteProjects } from '../hooks/useNoteProjects.js';
import { useFabPosition } from '../hooks/useFabPosition.js';
import { NotesEditor } from './NotesEditor.js';

function PencilIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.756l8.61-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086zM11.189 6.25 9.75 4.811l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l6.286-6.287z"/>
    </svg>
  );
}

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
    </svg>
  );
}

const FAB_SIZE = 44;
const DRAG_THRESHOLD_PX = 4;
// Panel got wider now that there's a projects sidebar on the left.
const PANEL_W = 660;
const PANEL_GAP = 12;

/**
 * Floating draggable notes pencil + slide-in projects panel. Left rail
 * lists projects (with 'misc' pinned first and non-deletable); right
 * side is the active project's editor. Body cache is per-project so
 * switching between projects is instant.
 */
export function NotesFab() {
  const notes = useNoteProjects();
  const { pos, setPos } = useFabPosition();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        if (creating) { setCreating(false); setDraftName(''); return; }
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, creating]);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current; if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) d.moved = true;
      setPos({ x: d.originX + dx, y: d.originY + dy });
    };
    const onUp = () => {
      const d = dragRef.current;
      setIsDragging(false);
      if (d && !d.moved) setOpen((o) => !o);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, setPos]);

  const handleMouseDown = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, originX: pos.x, originY: pos.y, moved: false };
    setIsDragging(true);
  };

  const submitCreate = async () => {
    const name = draftName.trim();
    if (!name) { setCreating(false); return; }
    const created = await notes.createProject(name);
    if (created) {
      setCreating(false);
      setDraftName('');
    }
  };

  const handleDelete = async () => {
    if (!notes.canDelete) return;
    const current = notes.projects.find((p) => p.slug === notes.selected);
    if (!current) return;
    if (!confirm(`Delete project "${current.name}" and everything in it?`)) return;
    await notes.removeProject(current.slug);
  };

  const handleRename = async () => {
    if (!notes.canRename) return;
    const current = notes.projects.find((p) => p.slug === notes.selected);
    if (!current) return;
    const next = window.prompt('Rename project', current.name);
    if (next == null) return;
    await notes.renameProject(current.slug, next);
  };

  // Position the panel relative to the FAB (same logic as before,
  // adjusted for the new width).
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const h = typeof window === 'undefined' ? 768 : window.innerHeight;
  const placeAbove = pos.y > h / 2;
  const panelLeft = (pos.x + FAB_SIZE / 2 < w / 2)
    ? Math.max(12, pos.x)
    : Math.max(12, pos.x + FAB_SIZE - PANEL_W);
  const panelStyle: React.CSSProperties = placeAbove
    ? { left: panelLeft, bottom: h - pos.y + PANEL_GAP, right: 'auto', top: 'auto' }
    : { left: panelLeft, top: pos.y + FAB_SIZE + PANEL_GAP, right: 'auto', bottom: 'auto' };

  const currentProject = notes.projects.find((p) => p.slug === notes.selected);

  return (
    <>
      <button
        type="button"
        className={`notes-fab${isDragging ? ' notes-fab-dragging' : ''}`}
        onMouseDown={handleMouseDown}
        aria-label="Notes (drag to reposition)"
        title="Notes (⌘⇧N) — drag to move"
        style={{ left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }}
      >
        <PencilIcon />
      </button>
      {open && (
        <aside
          className="notes-panel notes-panel-multi"
          role="dialog"
          aria-label="Notes"
          style={panelStyle}
        >
          <nav className="notes-projects" aria-label="Note projects">
            <ul className="notes-projects-list">
              {notes.projects.map((p) => (
                <li key={p.slug}>
                  <button
                    type="button"
                    className={`notes-project-btn${p.slug === notes.selected ? ' notes-project-btn-active' : ''}`}
                    onClick={() => notes.setSelected(p.slug)}
                    title={p.slug === 'misc' ? 'Default catch-all — cannot be renamed or deleted' : p.name}
                  >
                    <span className="notes-project-name">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="notes-projects-footer">
              {creating ? (
                <form
                  className="notes-project-new-form"
                  onSubmit={(e) => { e.preventDefault(); void submitCreate(); }}
                >
                  <input
                    type="text"
                    autoFocus
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={submitCreate}
                    placeholder="Project name"
                    maxLength={48}
                    aria-label="New project name"
                  />
                </form>
              ) : (
                <button
                  type="button"
                  className="notes-project-new"
                  onClick={() => { setCreating(true); setDraftName(''); }}
                >+ New project</button>
              )}
            </div>
          </nav>
          <div className="notes-panel-main">
            <header className="notes-panel-header">
              <h3>{currentProject?.name ?? 'Notes'}</h3>
              <div className="notes-panel-actions">
                {notes.canRename && (
                  <button type="button" onClick={handleRename} title="Rename this project">Rename</button>
                )}
                {notes.canDelete && (
                  <button type="button" onClick={handleDelete} title="Delete this project" className="notes-panel-delete">Delete</button>
                )}
                <button type="button" className="notes-panel-close" onClick={() => setOpen(false)} aria-label="Close notes">
                  <CloseIcon />
                </button>
              </div>
            </header>
            <NotesEditor
              // Force a fresh editor mount per project so contenteditable
              // doesn't try to reconcile HTML across two completely
              // different bodies (which drops selection, mangles undo).
              key={notes.selected}
              initialHtml={notes.currentBody}
              onChange={notes.setBody}
              placeholder="Jot anything down — auto-saved. Select text + paste a URL to linkify."
            />
            <p className="notes-panel-hint">
              {notes.status === 'loading' && 'Loading notes…'}
              {notes.status === 'saving' && 'Saving…'}
              {notes.status === 'saved' && 'Saved'}
              {notes.status === 'offline' && 'Server offline — using browser cache'}
              {notes.status === 'error' && 'Save failed — will retry on next change'}
              {' · ⌘⇧N to toggle · drag the pencil to move'}
            </p>
          </div>
        </aside>
      )}
    </>
  );
}
