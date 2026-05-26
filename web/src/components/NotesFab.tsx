import { useEffect, useMemo, useState } from 'react';
import { useNotes } from '../hooks/useNotes.js';
import { handlePasteLinkify } from '../lib/pasteLinkify.js';
import { renderNotesToHtml } from '../lib/renderNotes.js';

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

/**
 * Floating "notes" pencil button + slide-in panel. Persists to localStorage
 * via useNotes, so the notes survive reloads and follow the user across the
 * entire app (every tab, the drawer, etc.).
 */
type Mode = 'write' | 'preview';

export function NotesFab() {
  const { notes, setNotes, clear } = useNotes();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('write');
  const previewHtml = useMemo(() => renderNotesToHtml(notes), [notes]);

  // Toggle with Cmd/Ctrl + Shift + N for keyboard access.
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

  return (
    <>
      <button
        type="button"
        className="notes-fab"
        onClick={() => setOpen((o) => !o)}
        aria-label="Open notes"
        title="Notes (⌘⇧N)"
      >
        <PencilIcon />
      </button>
      {open && (
        <aside className="notes-panel" role="dialog" aria-label="Notes">
          <header className="notes-panel-header">
            <h3>Notes</h3>
            <div className="notes-panel-actions">
              <div className="notes-mode-toggle" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'write'}
                  className={mode === 'write' ? 'notes-mode-active' : ''}
                  onClick={() => setMode('write')}
                >Write</button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mode === 'preview'}
                  className={mode === 'preview' ? 'notes-mode-active' : ''}
                  onClick={() => setMode('preview')}
                >Preview</button>
              </div>
              <button type="button" onClick={clear} disabled={!notes} title="Clear notes">Clear</button>
              <button type="button" className="notes-panel-close" onClick={() => setOpen(false)} aria-label="Close notes">
                <CloseIcon />
              </button>
            </div>
          </header>
          {mode === 'write' ? (
            <textarea
              className="notes-textarea"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onPaste={handlePasteLinkify}
              placeholder="Jot anything down — auto-saved to this browser. Select text + paste a URL to linkify."
              autoFocus
            />
          ) : (
            <div
              className="notes-preview"
              dangerouslySetInnerHTML={{ __html: previewHtml || '<p class="notes-preview-empty">Nothing to preview yet.</p>' }}
            />
          )}
          <p className="notes-panel-hint">Saved automatically · ⌘⇧N to toggle</p>
        </aside>
      )}
    </>
  );
}
