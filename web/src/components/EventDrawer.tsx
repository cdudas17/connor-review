import { useEffect } from 'react';
import type { CalendarEvent } from '../types.js';

function CloseIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06z"/>
    </svg>
  );
}

interface Props {
  current: CalendarEvent | null;
  onClose: () => void;
}

function fmtRange(start: string | null, end: string | null, allDay: boolean): string {
  if (!start) return '';
  const s = new Date(start);
  const e = end ? new Date(end) : null;
  if (allDay) {
    return s.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  }
  const dateStr = s.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  const tStr = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} · ${tStr(s)}${e ? ' – ' + tStr(e) : ''}`;
}

/** Lightweight drawer that mirrors PR / Issue drawer chrome — shows event
 * title, time range, attendees, conference link, location, and description.
 * Read-only; "Open in Google Calendar" link covers the rest. */
export function EventDrawer({ current, onClose }: Props) {
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, onClose]);

  if (!current) return null;

  const me = current.attendees.find((a) => a.isSelf);
  const others = current.attendees.filter((a) => !a.isSelf);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="drawer event-drawer" aria-label={`Event: ${current.title}`}>
        <button type="button" className="drawer-close has-tooltip" data-tooltip="Close (Esc)" aria-label="Close drawer" onClick={onClose}>
          <CloseIcon size={18} />
        </button>
        <header className="pr-header">
          <div className="pr-header-title">
            <h2>{current.title}</h2>
            {current.status === 'cancelled' && (
              <span className="issue-state-badge issue-state-closed">Cancelled</span>
            )}
            {me?.responseStatus && me.responseStatus !== 'needsAction' && (
              <span className={`event-rsvp event-rsvp-${me.responseStatus}`}>{me.responseStatus}</span>
            )}
          </div>
          <p className="pr-header-meta">
            {fmtRange(current.start, current.end, current.isAllDay)}
            {current.location && <> {' · '} <span title={current.location}>{current.location}</span></>}
          </p>
        </header>

        {current.conferenceUri && (
          <p className="event-conf-row">
            <a className="event-conf-join" href={current.conferenceUri} target="_blank" rel="noopener noreferrer">
              Join {current.conferenceName ?? 'meeting'} ↗
            </a>
          </p>
        )}

        {current.htmlLink && (
          <p className="event-extra-links">
            <a href={current.htmlLink} target="_blank" rel="noopener noreferrer">Open in Google Calendar ↗</a>
          </p>
        )}

        {others.length > 0 && (
          <section className="event-attendees">
            <h3>Attendees ({current.attendees.length})</h3>
            <ul>
              {current.attendees.map((a) => (
                <li key={a.email ?? a.displayName ?? Math.random()} className={`event-attendee event-attendee-${a.responseStatus ?? 'unknown'}`}>
                  <span className="event-attendee-name">{a.displayName ?? a.email ?? 'Unknown'}{a.isSelf ? ' (you)' : ''}{a.isOrganizer ? ' · organizer' : ''}</span>
                  <span className="event-attendee-status">{a.responseStatus ?? 'needsAction'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {current.description && (
          <section className="event-description">
            <h3>Description</h3>
            {/* Google Calendar descriptions are sometimes HTML; render as
                pre-wrap text to avoid arbitrary HTML injection. */}
            <pre className="event-description-body">{current.description.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').trim()}</pre>
          </section>
        )}
      </aside>
    </>
  );
}
