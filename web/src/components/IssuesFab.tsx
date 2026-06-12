import { useEffect, useRef, useState } from 'react';
import { useFabPosition } from '../hooks/useFabPosition.js';
import { useMyIssues } from '../hooks/useMyIssues.js';

function IssueOpenedIcon({ size = 18 }: { size?: number }) {
  // GitHub Octicons "issue-opened" (16×16).
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z"/>
      <path fill="currentColor" d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/>
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
const PANEL_W = 460;
const PANEL_GAP = 12;

function formatTimeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const diffSec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (diffSec < 60) return 'just now';
  const m = Math.floor(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(t).toLocaleDateString();
}

/**
 * Floating draggable GitHub-issues button + slide-in panel. Same UX/affordances
 * as NotesFab — click to toggle the panel, press-and-drag to reposition,
 * position persisted to its own localStorage key. Panel lists the viewer's
 * open issues (assigned by default) sorted most-recently-updated first.
 *
 * The fetch is lazy: it only fires when the panel first opens, so we don't
 * burn a `gh search` on every app load.
 */
export function IssuesFab() {
  const { pos, setPos } = useFabPosition({
    storageKey: 'connor-review.issuesFabPosition.v1',
    // Default: bottom-left, ~70px inset above the notes FAB so they don't
    // overlap before the user repositions either of them.
    defaultPosition: ({ h }) => ({ x: 20, y: h - FAB_SIZE - 20 - (FAB_SIZE + 12) }),
  });
  const [open, setOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);

  // 'either' = assigned ∪ authored. Matches the user's mental model of "issues
  // I care about": ones someone gave me + ones I opened myself.
  const { issues, loading, error, lastFetchedAt, refresh } = useMyIssues({ enabled: open, scope: 'either' });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘⇧I to toggle (matches the ⌘⇧N notes shortcut).
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

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
    if (e.button !== 0) return;
    e.preventDefault();
    dragRef.current = {
      startX: e.clientX, startY: e.clientY,
      originX: pos.x, originY: pos.y,
      moved: false,
    };
    setIsDragging(true);
  };

  // Mirror NotesFab's panel placement: anchor by bottom when the FAB is in
  // the lower half of the viewport, otherwise by top.
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
        className={`issues-fab${isDragging ? ' issues-fab-dragging' : ''}`}
        onMouseDown={handleMouseDown}
        aria-label="My open issues (drag to reposition)"
        title="My open issues (⌘⇧I) — drag to move"
        style={{ left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }}
      >
        <IssueOpenedIcon />
        {issues.length > 0 && <span className="issues-fab-count" aria-hidden="true">{issues.length}</span>}
      </button>
      {open && (
        <aside
          className="issues-panel"
          role="dialog"
          aria-label="My open issues"
          style={panelStyle}
        >
          <header className="issues-panel-header">
            <h3>My open issues{issues.length > 0 ? ` (${issues.length})` : ''}</h3>
            <div className="issues-panel-actions">
              <button type="button" onClick={() => void refresh()} disabled={loading} title="Refetch the list">
                {loading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button type="button" className="issues-panel-close" onClick={() => setOpen(false)} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
          </header>
          {error && (
            <p className="issues-panel-error">Failed to load: {error.message}</p>
          )}
          {!loading && !error && issues.length === 0 && (
            <p className="issues-panel-empty">No open issues assigned to you.</p>
          )}
          {issues.length > 0 && (
            <ul className="issues-list">
              {issues.map((i) => (
                <li key={`${i.repository}#${i.number}`} className="issues-list-item">
                  <a href={i.url} target="_blank" rel="noopener noreferrer" className="issues-list-link">
                    <span className="issues-list-title">{i.title}</span>
                    <span className="issues-list-meta">
                      <code>{i.repository}#{i.number}</code>
                      {i.authorLogin && <> · by {i.authorLogin}</>}
                      <> · updated {formatTimeAgo(i.updatedAt)}</>
                    </span>
                    {i.labels.length > 0 && (
                      <span className="issues-list-labels">
                        {i.labels.slice(0, 4).map((l) => (
                          <span key={l} className="issues-list-label">{l}</span>
                        ))}
                        {i.labels.length > 4 && <span className="issues-list-label-more">+{i.labels.length - 4}</span>}
                      </span>
                    )}
                  </a>
                </li>
              ))}
            </ul>
          )}
          <p className="issues-panel-hint">
            {lastFetchedAt && !loading && `Last fetched ${formatTimeAgo(new Date(lastFetchedAt).toISOString())} · `}
            ⌘⇧I to toggle · drag the icon to move
          </p>
        </aside>
      )}
    </>
  );
}
