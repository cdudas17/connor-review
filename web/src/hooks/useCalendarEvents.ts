import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import type { CalendarEvent } from '../types.js';
import { workWeekRange } from '../lib/workWeek.js';

const REFRESH_MS = 5 * 60_000;

type AuthState =
  | { kind: 'unknown' }
  | { kind: 'needs-setup'; message: string }
  | { kind: 'ready' };

interface State {
  auth: AuthState;
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
}

/** Calendar tab data via `gcalcli`. On mount, asks the server whether
 * gcalcli is installed and authenticated; if so, fetches the next
 * 7 days of events and auto-refreshes every 5 min while the tab is
 * visible. If gcalcli is missing or not authenticated, surfaces the
 * server's setup hint so the user can fix it from a single message in
 * the UI. */
export function useCalendarEvents() {
  const [state, setState] = useState<State>({
    auth: { kind: 'unknown' },
    events: [],
    loading: false,
    error: null,
    lastFetchedAt: null,
  });
  const cancelledRef = useRef(false);

  const checkAuth = useCallback(async () => {
    try {
      const s = await api.getCalendarAuthStatus();
      if (cancelledRef.current) return s;
      if (s.connected) {
        setState((p) => ({ ...p, auth: { kind: 'ready' } }));
      } else {
        setState((p) => ({ ...p, auth: { kind: 'needs-setup', message: s.configurationError ?? 'Calendar is not set up.' } }));
      }
      return s;
    } catch (e) {
      setState((p) => ({ ...p, auth: { kind: 'needs-setup', message: (e as Error).message } }));
      return { connected: false, configured: false, configurationError: (e as Error).message };
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setState((p) => ({ ...p, loading: true, error: null }));
    try {
      // Pull events for the exact Mon–Fri window the agenda will render,
      // so past events from earlier in the week still come back.
      const { start, end } = workWeekRange(new Date());
      const r = await api.getCalendarEvents({ start: start.toISOString(), end: end.toISOString() });
      if (cancelledRef.current) return;
      setState((p) => ({
        ...p,
        auth: { kind: 'ready' },
        events: r.events,
        loading: false,
        lastFetchedAt: Date.now(),
        error: null,
      }));
    } catch (e) {
      if (cancelledRef.current) return;
      const err = e as ApiCallError;
      // 503/401 here means gcalcli not installed or not authenticated —
      // flip back to needs-setup with the server's hint.
      if (err.status === 503 || err.status === 401) {
        setState((p) => ({ ...p, loading: false, auth: { kind: 'needs-setup', message: err.message } }));
        return;
      }
      setState((p) => ({ ...p, loading: false, error: err.message }));
    }
  }, []);

  // Initial: check auth → fetch if ready.
  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      const s = await checkAuth();
      if (cancelledRef.current) return;
      if (s.connected) void fetchEvents();
    })();
    return () => { cancelledRef.current = true; };
  }, [checkAuth, fetchEvents]);

  // Auto-refresh every 5 min while ready and tab visible.
  useEffect(() => {
    if (state.auth.kind !== 'ready') return;
    const tick = () => {
      if (document.visibilityState === 'visible') void fetchEvents();
    };
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, [state.auth.kind, fetchEvents]);

  const recheck = useCallback(async () => {
    const s = await checkAuth();
    if (s.connected) void fetchEvents();
  }, [checkAuth, fetchEvents]);

  return {
    auth: state.auth,
    events: state.events,
    loading: state.loading,
    error: state.error,
    lastFetchedAt: state.lastFetchedAt,
    refresh: fetchEvents,
    recheck,
  };
}
