import { useEffect, useMemo, useRef, useState } from 'react';
import { useFabPosition } from '../hooks/useFabPosition.js';
import type { CalendarEvent } from '../types.js';

interface Props {
  events: CalendarEvent[];
  /** True when the Calendar tab knows about gcalcli auth and has data
   * (or at least, won't until it's set up). When false the FAB is hidden so
   * we don't surface a useless "no meetings" while auth is still negotiating. */
  hasCalendar: boolean;
  /** Click handler — usually jumps the user to the Calendar tab. */
  onOpen?: () => void;
}

const DRAG_THRESHOLD_PX = 4;

function ClockIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Zm.75 2.75a.75.75 0 0 0-1.5 0V8c0 .2.08.39.22.53l2.5 2.5a.75.75 0 1 0 1.06-1.06L8.75 7.69V4.25Z"/>
    </svg>
  );
}

interface NextOrNow {
  /** What the FAB should say. Always short — the FAB is small. */
  label: string;
  /** 'live' = currently in a meeting; 'soon' = ≤5 min away; 'idle' = nothing
   * near; 'free' = no more events today. Drives colour. */
  state: 'live' | 'soon' | 'idle' | 'free';
}

function fmtMins(mins: number): string {
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

function computeStatus(events: CalendarEvent[], now: Date): NextOrNow {
  const nowMs = now.getTime();
  type Span = { startMs: number; endMs: number; isAllDay: boolean };
  const spans: Span[] = [];
  for (const e of events) {
    if (!e.start) continue;
    const sMs = Date.parse(e.start);
    if (Number.isNaN(sMs)) continue;
    const eMs = e.end ? Date.parse(e.end) : sMs + 30 * 60_000;
    if (Number.isNaN(eMs)) continue;
    spans.push({ startMs: sMs, endMs: eMs, isAllDay: e.isAllDay });
  }
  // Ignore all-day events — "next meeting in 8h" because of a birthday
  // banner isn't useful.
  const concrete = spans.filter((s) => !s.isAllDay);

  // 1. In a meeting right now?
  const ongoing = concrete.find((s) => s.startMs <= nowMs && nowMs < s.endMs);
  if (ongoing) {
    const left = Math.round((ongoing.endMs - nowMs) / 60_000);
    return { state: 'live', label: `${fmtMins(left)} left` };
  }

  // 2. Next upcoming meeting?
  const upcoming = concrete.filter((s) => s.startMs > nowMs).sort((a, b) => a.startMs - b.startMs);
  const next = upcoming[0];
  if (next) {
    const until = Math.round((next.startMs - nowMs) / 60_000);
    if (until <= 5) return { state: 'soon', label: `in ${fmtMins(until)}` };
    // Idle only when the next event is TODAY. If your next meeting isn't
    // until tomorrow (or later), the FAB shows "Free" — a "in 2d4h"
    // countdown isn't useful and visually it looked the same as a real
    // imminent meeting.
    const nextDate = new Date(next.startMs);
    const today = new Date(nowMs);
    const sameDay = nextDate.getFullYear() === today.getFullYear()
      && nextDate.getMonth() === today.getMonth()
      && nextDate.getDate() === today.getDate();
    if (sameDay) return { state: 'idle', label: `in ${fmtMins(until)}` };
  }

  return { state: 'free', label: 'Free' };
}

/** Floating draggable "next meeting" FAB. Shows a compact countdown to the
 * user's next event (or "X left" while in one), reading from the same
 * useCalendarEvents source the Calendar tab already mounts. Click → jumps
 * to the Calendar tab. */
export function NextMeetingFab({ events, hasCalendar, onOpen }: Props) {
  const { pos, setPos } = useFabPosition({
    // v2 — default moved bottom-right → top-left; bumping the storage key
    // discards the old persisted position so this lands at the new default
    // immediately instead of where the user happened to leave the v1 button.
    storageKey: 'connor-review.nextMeetingFabPosition.v2',
    defaultPosition: () => ({ x: 20, y: 20 }),
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{
    startX: number; startY: number;
    originX: number; originY: number;
    moved: boolean;
  } | null>(null);

  // Tick every 30s so countdowns stay close to truth without burning a render
  // every second.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

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
      if (d && !d.moved && onOpen) onOpen();
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDragging, setPos, onOpen]);

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

  const status = useMemo(() => computeStatus(events, new Date()), [events]);

  if (!hasCalendar) return null;

  const stateClass = `next-meeting-fab-${status.state}`;
  return (
    <button
      type="button"
      className={`next-meeting-fab ${stateClass}${isDragging ? ' next-meeting-fab-dragging' : ''}`}
      onMouseDown={handleMouseDown}
      aria-label={`Next meeting: ${status.label}`}
      title={`Next meeting: ${status.label} — drag to move, click to open Calendar`}
      style={{ left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }}
    >
      <ClockIcon />
      <span className="next-meeting-fab-label">{status.label}</span>
    </button>
  );
}
