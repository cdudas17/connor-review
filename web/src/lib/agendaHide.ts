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

/** True when the event is on the user's hide list. */
export function isHidden(event: CalendarEvent, hidden: ReadonlySet<string>): boolean {
  return hidden.has(hideKeyOf(event));
}

/** Convenience — filter out hidden events in one pass. */
export function filterVisible(events: CalendarEvent[], hidden: ReadonlySet<string>): CalendarEvent[] {
  if (hidden.size === 0) return events;
  return events.filter((e) => !isHidden(e, hidden));
}
