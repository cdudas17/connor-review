import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent } from '../types.js';
import { isWeekday, workWeekMonday } from '../lib/workWeek.js';

interface Props {
  events: CalendarEvent[];
  /** Kept for forward-compat — fires only for events that actually have a
   * title. Title-less busy blocks are visual-only (no drawer to open). */
  onOpen: (event: CalendarEvent) => void;
  /** Hide this event from future agenda + FAB output. Titled events hide
   *  every occurrence with that title (so recurring "holds" collapse to
   *  one click); untitled blocks hide the single occurrence only. See
   *  `lib/agendaHide.ts`. */
  onHide?: (event: CalendarEvent) => void;
  /** How many events are currently hidden (post-filter count already
   *  applied to `events`). Drives the "Show hidden" footer when > 0. */
  hiddenCount?: number;
  /** Wipe the hide list — used by the footer's "Show N hidden" button. */
  onShowAllHidden?: () => void;
}

// Fixed window for the timeline view. Events fully outside this range are
// shown as small chips above the bar so they aren't lost.
const DAY_START_HOUR = 7;   // 7 AM
const DAY_END_HOUR = 20;    // 8 PM
const DAY_HOURS = DAY_END_HOUR - DAY_START_HOUR;

function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function fmtDayHeader(d: Date): string {
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}


interface DayBucket {
  date: Date;
  /** Events that fall inside DAY_START_HOUR..DAY_END_HOUR — rendered as
   * positioned bars on the timeline. */
  inWindow: CalendarEvent[];
  /** All-day events — rendered as a chip above the timeline. */
  allDay: CalendarEvent[];
  /** Events outside the day window — rendered as chips so they aren't lost. */
  outOfWindow: CalendarEvent[];
}

/** Convert an ISO timestamp into "hours since DAY_START_HOUR of its local day".
 * Used to position event bars along the timeline. */
function hoursIntoDay(iso: string, dayStart: Date): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return 0;
  return (t - dayStart.getTime()) / 3_600_000 - DAY_START_HOUR;
}

export function CalendarAgenda({ events, onOpen, onHide, hiddenCount = 0, onShowAllHidden }: Props) {
  // Tick once a minute so the "now" line advances without a hard refresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const days = useMemo(() => {
    // Exactly the 5 work days of this week (or next week, when today is
    // Sat/Sun). Events outside the window — including next week's events
    // we happened to fetch — are dropped so the view is always a clean
    // Mon–Fri snapshot.
    const byDay = new Map<string, DayBucket>();
    const monday = workWeekMonday(new Date());
    const weekStart = monday.getTime();
    const weekEnd = monday.getTime() + 5 * 86_400_000;   // exclusive (Saturday 00:00)
    for (let i = 0; i < 5; i++) {
      const d = new Date(weekStart + i * 86_400_000);
      byDay.set(dayKey(d), { date: d, inWindow: [], allDay: [], outOfWindow: [] });
    }
    for (const e of events) {
      if (!e.start) continue;
      const startDate = new Date(e.start);
      if (Number.isNaN(startDate.getTime())) continue;
      const localMidnight = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
      if (!isWeekday(localMidnight)) continue;
      const t = localMidnight.getTime();
      if (t < weekStart || t >= weekEnd) continue;   // outside this work week
      const bucket = byDay.get(dayKey(localMidnight));
      if (!bucket) continue;
      if (e.isAllDay) {
        bucket.allDay.push(e);
      } else {
        const startH = hoursIntoDay(e.start, localMidnight);
        const endH = e.end ? hoursIntoDay(e.end, localMidnight) : startH + 0.5;
        const overlapsWindow = endH > 0 && startH < DAY_HOURS;
        if (overlapsWindow) bucket.inWindow.push(e);
        else bucket.outOfWindow.push(e);
      }
    }
    return Array.from(byDay.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [events]);

  // Hour markers — render every 2 hours for legibility (8a, 10a, 12p, …).
  const hourMarkers: Array<{ label: string; pct: number }> = [];
  for (let h = DAY_START_HOUR; h <= DAY_END_HOUR; h += 2) {
    const pct = ((h - DAY_START_HOUR) / DAY_HOURS) * 100;
    const hour12 = ((h + 11) % 12) + 1;
    const ampm = h < 12 ? 'a' : 'p';
    hourMarkers.push({ label: `${hour12}${ampm}`, pct });
  }

  const now = new Date();
  const todayKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate()));

  return (
    <div className="calendar-timeline">
      <div className="calendar-timeline-axis" aria-hidden="true">
        {hourMarkers.map((m) => (
          <span key={m.pct} className="calendar-timeline-axis-tick" style={{ left: `${m.pct}%` }}>{m.label}</span>
        ))}
      </div>
      {days.map((day) => {
        const isToday = dayKey(day.date) === todayKey;
        const nowHoursIntoDay = isToday ? hoursIntoDay(now.toISOString(), day.date) : -1;
        const showNowMarker = isToday && nowHoursIntoDay >= 0 && nowHoursIntoDay <= DAY_HOURS;
        return (
          <section key={dayKey(day.date)} className={`calendar-day-row${isToday ? ' calendar-day-row-today' : ''}`}>
            <h3 className="calendar-day-label">{fmtDayHeader(day.date)}</h3>
            <div className="calendar-day-bar">
              {/* Background hour-line ticks (visual aid) */}
              {hourMarkers.map((m) => (
                <span key={m.pct} className="calendar-day-tick" style={{ left: `${m.pct}%` }} aria-hidden="true" />
              ))}
              {/* Busy blocks */}
              {day.inWindow.map((e) => {
                const startH = Math.max(0, hoursIntoDay(e.start!, day.date));
                const endH = Math.min(DAY_HOURS, e.end ? hoursIntoDay(e.end, day.date) : startH + 0.5);
                const leftPct = (startH / DAY_HOURS) * 100;
                const widthPct = Math.max(0.5, ((endH - startH) / DAY_HOURS) * 100);
                const hasTitle = !!e.title && e.title !== '(no title)';
                const label = `${fmtTime(e.start)}${e.end ? ' – ' + fmtTime(e.end) : ''}${hasTitle ? ` · ${e.title}` : ''}`;
                return (
                  <div
                    key={e.id}
                    className={`calendar-block${hasTitle ? ' calendar-block-titled' : ''}`}
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                    title={label}
                    onClick={hasTitle ? () => onOpen(e) : undefined}
                    role={hasTitle ? 'button' : undefined}
                    tabIndex={hasTitle ? 0 : -1}
                  >
                    {onHide && (
                      // Hide-from-agenda affordance. Sits inside the block so
                      // it's discoverable via hover regardless of title. Stop
                      // propagation so clicking × doesn't also open the drawer.
                      <button
                        type="button"
                        className="calendar-block-hide"
                        aria-label={hasTitle ? `Hide "${e.title}" from agenda` : 'Hide this block from agenda'}
                        title={hasTitle ? `Hide "${e.title}" from agenda` : 'Hide this block from agenda'}
                        onClick={(ev) => { ev.stopPropagation(); onHide(e); }}
                      >×</button>
                    )}
                  </div>
                );
              })}
              {/* "Now" line on today */}
              {showNowMarker && (
                <div
                  className="calendar-now-marker"
                  style={{ left: `${(nowHoursIntoDay / DAY_HOURS) * 100}%` }}
                  aria-hidden="true"
                />
              )}
            </div>
            {(day.allDay.length > 0 || day.outOfWindow.length > 0) && (
              <div className="calendar-day-extras">
                {day.allDay.map((e) => (
                  <span key={e.id} className="calendar-day-extra calendar-day-extra-allday" title={e.title || 'All day'}>All day</span>
                ))}
                {day.outOfWindow.map((e) => (
                  <span key={e.id} className="calendar-day-extra" title={e.title || ''}>{fmtTime(e.start)}{e.end ? ` – ${fmtTime(e.end)}` : ''}</span>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {hiddenCount > 0 && onShowAllHidden && (
        // Undo bar — the only way back to hidden events. Nukes the whole
        // hide list; per-event restore isn't worth the UI right now since
        // hidden holds are usually recurring and clearing all is fine.
        <p className="calendar-hidden-footer">
          <span className="calendar-hidden-footer-count">{hiddenCount} event{hiddenCount === 1 ? '' : 's'} hidden</span>
          <button type="button" className="link-button" onClick={onShowAllHidden}>Show all hidden</button>
        </p>
      )}
    </div>
  );
}
