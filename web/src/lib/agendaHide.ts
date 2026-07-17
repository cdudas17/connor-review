import type { CalendarEvent } from '../types.js';

/**
 * Client-side "hide this from the agenda" state. The user has calendar
 * blocks (personal holds, "focus time" recurring events, etc.) that
 * exist to prevent other meetings from being booked but which they
 * don't want cluttering the in-app agenda or triggering the Next
 * Meeting FAB. We never write anything back to Google — this is
 * app-local visibility filtering only.
 *
 * Hide keys use the event's title when it has one, so a recurring
 * hold like "Focus time" is hidden across every occurrence with one
 * click. Untitled blocks (Gusto free/busy-only view) fall back to the
 * per-occurrence id.
 */
export function hideKeyOf(event: CalendarEvent): string {
  const title = event.title?.trim();
  if (title && title !== '(no title)') return `title:${title}`;
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
