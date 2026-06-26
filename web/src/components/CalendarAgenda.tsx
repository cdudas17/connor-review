import { useMemo } from 'react';
import type { CalendarEvent } from '../types.js';

interface Props {
  events: CalendarEvent[];
  /** Click handler — only fires for events that actually have a title;
   * title-less "busy block" rows are non-interactive because there's
   * nothing to drill into. */
  onOpen: (event: CalendarEvent) => void;
}

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDayHeader(d: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const same = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Today';
  if (same(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function responseColor(status: string | null): string | undefined {
  // Cosmetic — accepted / tentative / declined / needsAction
  if (status === 'declined') return '#8b949e';
  if (status === 'tentative') return '#d29922';
  return undefined; // accepted / needsAction / null → default fg
}

export function CalendarAgenda({ events, onOpen }: Props) {
  const grouped = useMemo(() => {
    // Group events by local-date key, preserving sort order.
    const byDay = new Map<string, { date: Date; events: CalendarEvent[] }>();
    for (const e of events) {
      if (!e.start) continue;
      const d = new Date(e.start);
      if (Number.isNaN(d.getTime())) continue;
      const localMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const key = dayKey(localMidnight);
      const bucket = byDay.get(key) ?? { date: localMidnight, events: [] };
      bucket.events.push(e);
      byDay.set(key, bucket);
    }
    return Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [events]);

  if (events.length === 0) {
    return <p className="calendar-empty">No events in the next 7 days.</p>;
  }

  return (
    <div className="calendar-agenda">
      {grouped.map((day) => (
        <section key={dayKey(day.date)} className="calendar-day">
          <h3 className="calendar-day-header">{fmtDayHeader(day.date)}</h3>
          <ul className="calendar-day-list">
            {day.events.map((e) => {
              const declined = e.myResponseStatus === 'declined';
              // A "real" event has a title and is worth opening a drawer
              // for. A title-less row is a free/busy block (when the
              // calendar share is restricted to free/busy only); render
              // it as a non-interactive time chip with no title column.
              const hasTitle = !!e.title && e.title !== '(no title)';
              const className = `calendar-event${hasTitle ? '' : ' calendar-event-busy-only'}${declined ? ' calendar-event-declined' : ''}${e.myResponseStatus === 'tentative' ? ' calendar-event-tentative' : ''}`;
              if (!hasTitle) {
                return (
                  <li key={e.id} className={className}>
                    <span className="calendar-event-time" style={{ color: responseColor(e.myResponseStatus) }}>
                      {e.isAllDay ? 'All day' : `${fmtTime(e.start)}${e.end ? ' – ' + fmtTime(e.end) : ''}`}
                    </span>
                    <span className="calendar-event-busy-label">Busy</span>
                  </li>
                );
              }
              return (
                <li
                  key={e.id}
                  className={className}
                  onClick={() => onOpen(e)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(e); } }}
                >
                  <span className="calendar-event-time" style={{ color: responseColor(e.myResponseStatus) }}>
                    {e.isAllDay ? 'All day' : `${fmtTime(e.start)}${e.end ? ' – ' + fmtTime(e.end) : ''}`}
                  </span>
                  <span className="calendar-event-title">{e.title}</span>
                  {e.conferenceUri && (
                    <a
                      className="calendar-event-conf"
                      href={e.conferenceUri}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(ev) => ev.stopPropagation()}
                      title={e.conferenceName ? `Join (${e.conferenceName})` : 'Join'}
                    >Join</a>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
