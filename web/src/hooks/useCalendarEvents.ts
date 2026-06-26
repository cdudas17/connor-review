import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import type { CalendarEvent } from '../types.js';

const REFRESH_MS = 5 * 60_000;

type AuthState =
  | { kind: 'unknown' }
  | { kind: 'unconfigured'; message: string }
  | { kind: 'disconnected' }
  | { kind: 'connected' };

interface State {
  auth: AuthState;
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
}

/** Calendar tab data: holds auth state (configured? connected?) plus the
 * next-7-day event list. Auto-refreshes every 5 minutes while the tab is
 * visible; pauses when hidden so the OAuth token doesn't churn refresh
 * cycles in a background tab. */
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
      if (cancelledRef.current) return;
      if (!s.configured) {
        setState((p) => ({ ...p, auth: { kind: 'unconfigured', message: s.configurationError ?? 'Google OAuth client is not configured.' } }));
        return;
      }
      setState((p) => ({ ...p, auth: { kind: s.connected ? 'connected' : 'disconnected' } }));
    } catch (e) {
      setState((p) => ({ ...p, auth: { kind: 'disconnected' }, error: (e as Error).message }));
    }
  }, []);

  const fetchEvents = useCallback(async () => {
    setState((p) => ({ ...p, loading: true, error: null }));
    try {
      const r = await api.getCalendarEvents();
      if (cancelledRef.current) return;
      setState((p) => ({
        ...p,
        auth: { kind: 'connected' },
        events: r.events,
        loading: false,
        lastFetchedAt: Date.now(),
        error: null,
      }));
    } catch (e) {
      if (cancelledRef.current) return;
      const err = e as ApiCallError;
      // 401 here means token revoked / not connected — flip auth state.
      if (err.status === 401) {
        setState((p) => ({ ...p, auth: { kind: 'disconnected' }, loading: false }));
        return;
      }
      setState((p) => ({ ...p, loading: false, error: err.message }));
    }
  }, []);

  // Initial: check auth → fetch if connected.
  useEffect(() => {
    cancelledRef.current = false;
    void (async () => {
      await checkAuth();
    })();
    return () => { cancelledRef.current = true; };
  }, [checkAuth]);

  // When auth flips to connected, fetch events. When it flips to disconnected,
  // clear events.
  useEffect(() => {
    if (state.auth.kind === 'connected' && state.events.length === 0 && !state.loading && !state.error) {
      void fetchEvents();
    }
    if (state.auth.kind === 'disconnected' && state.events.length > 0) {
      setState((p) => ({ ...p, events: [], lastFetchedAt: null }));
    }
  }, [state.auth.kind, state.events.length, state.loading, state.error, fetchEvents]);

  // Auto-refresh every 5 min while connected and tab visible.
  useEffect(() => {
    if (state.auth.kind !== 'connected') return;
    const tick = () => {
      if (document.visibilityState === 'visible') void fetchEvents();
    };
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, [state.auth.kind, fetchEvents]);

  const beginConnect = useCallback(async () => {
    const { url } = await api.getCalendarAuthUrl();
    // Open the consent flow in a popup. After the callback closes the tab,
    // poll auth-status until connected (or give up after ~2 minutes).
    window.open(url, 'gcal-oauth', 'width=520,height=640');
    const start = Date.now();
    const interval = setInterval(async () => {
      try {
        const s = await api.getCalendarAuthStatus();
        if (s.connected) {
          clearInterval(interval);
          setState((p) => ({ ...p, auth: { kind: 'connected' } }));
          void fetchEvents();
        } else if (Date.now() - start > 2 * 60_000) {
          clearInterval(interval);
        }
      } catch { /* keep polling */ }
    }, 2000);
  }, [fetchEvents]);

  const signOut = useCallback(async () => {
    await api.signOutOfCalendar();
    setState((p) => ({ ...p, auth: { kind: 'disconnected' }, events: [], lastFetchedAt: null }));
  }, []);

  return {
    auth: state.auth,
    events: state.events,
    loading: state.loading,
    error: state.error,
    lastFetchedAt: state.lastFetchedAt,
    refresh: fetchEvents,
    beginConnect,
    signOut,
  };
}
