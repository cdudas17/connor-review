/**
 * Helpers for "this work week" — Mon through Fri of the current week, or
 * the next work week when called on a Sat/Sun. Used by both the Calendar
 * agenda (to seed the timeline rows) and the events hook (to scope the
 * fetch window so past events from earlier in the week still come back).
 */

/** Monday of the work week to display. Mon–Fri → current week's Monday;
 * Sat–Sun → next week's Monday. */
export function workWeekMonday(today: Date): Date {
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = midnight.getDay();
  let delta: number;
  if (dow === 0) delta = 1;        // Sun → +1
  else if (dow === 6) delta = 2;   // Sat → +2 (next Monday)
  else delta = -(dow - 1);         // Mon=0, Tue=-1, …, Fri=-4
  return new Date(midnight.getTime() + delta * 86_400_000);
}

/** [start, end) range covering Mon 00:00 through Sat 00:00 — the five
 * work days of the chosen week. */
export function workWeekRange(today: Date): { start: Date; end: Date } {
  const start = workWeekMonday(today);
  const end = new Date(start.getTime() + 5 * 86_400_000);
  return { start, end };
}

export function isWeekday(d: Date): boolean {
  const dow = d.getDay();
  return dow !== 0 && dow !== 6;
}
