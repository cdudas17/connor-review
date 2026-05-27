import { useEffect, useRef, useState } from 'react';
import { useNotes } from '../hooks/useNotes.js';
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
const PANEL_W = 440;
const PANEL_GAP = 12;

/**
 * Floating draggable notes pencil + slide-in panel. Defaults to bottom-left.
 * Click to toggle the panel; press-and-drag to reposition the button anywhere
 * on screen. Position is persisted to localStorage and clamped to the viewport.
 */
export function NotesFab() {
  const { notes, setNotes, clear, status, filePath } = useNotes();
  const { pos, setPos } = useFabPosition();
  const [open, setOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number; startY: number;
    originX: number; originY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Window-level move/up listeners while a drag is in flight — the drag must
  // survive the pointer leaving the FAB.
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
      if (d && !d.moved) {
        // Treat as a click — toggle the panel.
        setOpen((o) => !o);
      }
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
    if (e.button !== 0) return; // primary button only
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      originX: pos.x, originY: pos.y,
      moved: false,
    };
    setIsDragging(true);
  };

  // Position the panel relative to the FAB. Anchor by *bottom* when placing above
  // so the PANEL_GAP is enforced regardless of the panel's actual rendered height
  // (which can be less than PANEL_H when max-height clips it). Anchor by top when
  // placing below.
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const h = typeof window === 'undefined' ? 768 : window.innerHeight;
  const placeAbove = pos.y > h / 2;
  const panelLeft = (pos.x + FAB_SIZE / 2 < w / 2)
    ? Math.max(12, pos.x)
    : Math.max(12, pos.x + FAB_SIZE - PANEL_W);
  const panelStyle: React.CSSProperties = placeAbove
    ? { left: panelLeft, bottom: h - pos.y + PANEL_GAP, right: 'auto', top: 'auto' }
    : { left: panelLeft, top: pos.y + FAB_SIZE + PANEL_GAP, right: 'auto', bottom: 'auto' };

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
          className="notes-panel"
          role="dialog"
          aria-label="Notes"
          style={panelStyle}
        >
          <header className="notes-panel-header">
            <h3>Notes</h3>
            <div className="notes-panel-actions">
              <button type="button" onClick={clear} disabled={!notes} title="Clear notes">Clear</button>
              <button type="button" className="notes-panel-close" onClick={() => setOpen(false)} aria-label="Close notes">
                <CloseIcon />
              </button>
            </div>
          </header>
          <NotesEditor
            initialHtml={notes}
            onChange={setNotes}
            placeholder="Jot anything down — auto-saved. Select text + paste a URL to linkify."
          />
          <p className="notes-panel-hint">
            {status === 'loading' && 'Loading notes…'}
            {status === 'saving' && 'Saving…'}
            {status === 'saved' && (filePath ? <>Saved to <code>{filePath}</code></> : 'Saved')}
            {status === 'offline' && 'Server offline — using browser cache'}
            {status === 'error' && 'Save failed — will retry on next change'}
            {' · ⌘⇧N to toggle · drag the pencil to move'}
          </p>
        </aside>
      )}
    </>
  );
}
