import type { CalendarEvent } from '../types.js';

/**
 * Client-side "hide this from the agenda" state. The user has calendar
 * blocks (personal holds, "focus time" recurring events, etc.) that
 * exist to prevent other meetings from being booked but which they
 * don't want cluttering the in-app agenda or triggering the Next
 * Meeting FAB. We never write anything back to Google — this is
 * app-local visibility filtering only.
 *
 * Hide keys are per-occurrence (id-based). An earlier version keyed by
 * title so a recurring "Focus time" collapsed to one click, but under
 * Gusto's free/busy-only sharing every event carries the same generic
 * title (e.g. "Busy"), which meant one hide-click wiped the whole day.
 * Per-occurrence hiding is safe — the user re-hides new occurrences,
 * but that's a click per week, not a footgun.
 */
export function hideKeyOf(event: CalendarEvent): string {
  return `id:${event.id}`;
}

/** Events longer than this get auto-hidden — day-spanning holds
 *  ("OOO", "Focus Fridays", quarterly-planning-blocks) drown out the
 *  actual meetings on the busy-block timeline. Threshold is 4h. */
const LONG_EVENT_MS = 4 * 60 * 60 * 1000;

/** True when the event is on the user's hide list. */
export function isHidden(event: CalendarEvent, hidden: ReadonlySet<string>): boolean {
  return hidden.has(hideKeyOf(event));
}

/** True when the event exceeds the auto-hide duration cap. All-day
 *  events don't count — they have their own visual (allDay chips)
 *  and shouldn't be auto-suppressed. */
export function isLongEvent(event: CalendarEvent): boolean {
  if (event.isAllDay) return false;
  if (!event.start || !event.end) return false;
  const s = Date.parse(event.start);
  const e = Date.parse(event.end);
  if (Number.isNaN(s) || Number.isNaN(e)) return false;
  return e - s > LONG_EVENT_MS;
}

/** Convenience — filter out user-hidden events AND events over the
 *  duration cap in one pass. */
export function filterVisible(events: CalendarEvent[], hidden: ReadonlySet<string>): CalendarEvent[] {
  return events.filter((e) => !isHidden(e, hidden) && !isLongEvent(e));
}
