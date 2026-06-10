import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import type { ClaudeResponseState } from '../components/ClaudeResponseCard.js';

interface PRTarget { owner: string; repo: string; number: number; }
interface LineRange { path: string; startLine?: number; endLine: number; side: 'LEFT' | 'RIGHT' }

const SUMMARY_STORAGE_KEY = 'connor-review.claudeSummary.v1';
const THREAD_STORAGE_KEY = 'connor-review.claudeThread.v1';

/** Drop persisted responses older than this on hook mount. 30 days is generous
 * enough that you can pick up where you left off after a long break, while
 * still preventing unbounded localStorage growth. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Hard cap per bucket. With ~2KB per response and a 5MB quota, this gives ~10x
 * headroom even at the upper end. Eviction is LRU by `savedAt`. */
const MAX_ENTRIES = 200;

function prKey(p: PRTarget): string { return `${p.owner}/${p.repo}#${p.number}`; }
function threadKey(p: PRTarget, threadId: string): string { return `${prKey(p)}::${threadId}`; }

function loadStore(key: string): Record<string, ClaudeResponseState> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed != null ? parsed : {};
  } catch {
    return {};
  }
}

/** Save a store, but drop any entries still in `loading` — those would be stuck
 * if the page reloaded mid-request (the request itself dies with the page). */
function persistStore(key: string, store: Record<string, ClaudeResponseState>) {
  try {
    const stable: Record<string, ClaudeResponseState> = {};
    for (const [k, v] of Object.entries(store)) {
      if (v.loading) continue;
      stable[k] = v;
    }
    localStorage.setItem(key, JSON.stringify(stable));
  } catch { /* quota — ignore */ }
}

/** Strip entries older than MAX_AGE_MS and LRU-evict down to MAX_ENTRIES.
 * Returns the cleaned store; pure (no localStorage side effect). */
function sweepStore(store: Record<string, ClaudeResponseState>, now: number): Record<string, ClaudeResponseState> {
  const cutoff = now - MAX_AGE_MS;
  // First pass: drop too-old. Anything without a savedAt is treated as freshly
  // saved at the cutoff so old un-stamped entries don't all get wiped on the
  // first run — they'll get a real timestamp on the next ask.
  const fresh: Array<[string, ClaudeResponseState & { savedAt?: number }]> = [];
  for (const [k, v] of Object.entries(store)) {
    const savedAt = (v as ClaudeResponseState & { savedAt?: number }).savedAt;
    if (savedAt != null && savedAt < cutoff) continue;
    fresh.push([k, v]);
  }
  // Second pass: cap at MAX_ENTRIES. Sort by savedAt asc and drop oldest.
  if (fresh.length <= MAX_ENTRIES) {
    return Object.fromEntries(fresh);
  }
  fresh.sort((a, b) => {
    const aT = a[1].savedAt ?? 0;
    const bT = b[1].savedAt ?? 0;
    return aT - bT;
  });
  return Object.fromEntries(fresh.slice(fresh.length - MAX_ENTRIES));
}

interface Options {
  /** App's toast callback. Fired only when a response lands while the drawer is NOT on the asking PR. */
  onToast: (kind: 'success' | 'error' | 'info', message: string) => void;
  /** Currently-open drawer's PR key, or null when no drawer is open. Used to decide
   * whether a late-arriving response should toast (drawer closed / different PR)
   * vs just silently update state (drawer still on the asking PR). */
  currentPRKey: string | null;
}

/** Centralised Claude response state for the drawer's "Ask Claude" surfaces.
 *
 * - **Summary card** (one per PR): persisted across drawer close, PR navigation, page reload.
 * - **Thread reply cards** (one per PR + thread id): same.
 * - **Inline composer cards** (per file/line range): NOT owned here — those stay
 *   ephemeral inside DiffViewer because the composer itself is ephemeral.
 *
 * In-flight requests survive drawer close. When a response lands and the drawer
 * is no longer on the asking PR, we fire an info/error toast so the user knows
 * to reopen. The state itself is keyed by PR (+ thread), so reopening the
 * drawer always shows whatever's currently stored. */
export function useClaudeResponses(opts: Options) {
  const { onToast, currentPRKey } = opts;
  // Sweep on mount: drop entries past MAX_AGE_MS, cap at MAX_ENTRIES (LRU by
  // savedAt). Pure function so it's also straightforward to unit-test directly.
  const [summary, setSummary] = useState<Record<string, ClaudeResponseState>>(() => sweepStore(loadStore(SUMMARY_STORAGE_KEY), Date.now()));
  const [threads, setThreads] = useState<Record<string, ClaudeResponseState>>(() => sweepStore(loadStore(THREAD_STORAGE_KEY), Date.now()));

  // Per-key token: lets us discard a stale resolution if the user fires a second
  // ask on the same key before the first settles.
  const tokensRef = useRef<Map<string, number>>(new Map());

  // Ref-mirror of currentPRKey so the async resolver reads the up-to-date drawer
  // location, not the value captured when `ask*` was called.
  const currentPRKeyRef = useRef<string | null>(currentPRKey);
  useEffect(() => { currentPRKeyRef.current = currentPRKey; }, [currentPRKey]);

  useEffect(() => { persistStore(SUMMARY_STORAGE_KEY, summary); }, [summary]);
  useEffect(() => { persistStore(THREAD_STORAGE_KEY, threads); }, [threads]);

  const askSummary = useCallback((target: PRTarget, draft: string) => {
    const key = prKey(target);
    const token = (tokensRef.current.get(`summary::${key}`) ?? 0) + 1;
    tokensRef.current.set(`summary::${key}`, token);
    setSummary((s) => ({ ...s, [key]: { loading: true } }));
    api.askClaude(target.owner, target.repo, target.number, { draft })
      .then((res) => {
        if (tokensRef.current.get(`summary::${key}`) !== token) return;
        setSummary((s) => ({ ...s, [key]: { loading: false, body: res.response, truncatedDiff: res.truncatedDiff, savedAt: Date.now() } }));
        if (currentPRKeyRef.current !== key) {
          onToast('info', `Claude answered on ${key} — reopen to see it`);
        }
      })
      .catch((e) => {
        if (tokensRef.current.get(`summary::${key}`) !== token) return;
        const msg = (e as ApiCallError | Error).message;
        setSummary((s) => ({ ...s, [key]: { loading: false, error: msg, savedAt: Date.now() } }));
        if (currentPRKeyRef.current !== key) {
          onToast('error', `Claude failed for ${key}: ${msg}`);
        }
      });
  }, [onToast]);

  const askThread = useCallback((target: PRTarget, threadId: string, draft: string, lineRange: LineRange) => {
    const key = threadKey(target, threadId);
    const token = (tokensRef.current.get(`thread::${key}`) ?? 0) + 1;
    tokensRef.current.set(`thread::${key}`, token);
    setThreads((s) => ({ ...s, [key]: { loading: true } }));
    const prRef = prKey(target);
    api.askClaude(target.owner, target.repo, target.number, { draft, lineRange })
      .then((res) => {
        if (tokensRef.current.get(`thread::${key}`) !== token) return;
        setThreads((s) => ({ ...s, [key]: { loading: false, body: res.response, truncatedDiff: res.truncatedDiff, savedAt: Date.now() } }));
        if (currentPRKeyRef.current !== prRef) {
          onToast('info', `Claude answered a thread on ${prRef} — reopen to see it`);
        }
      })
      .catch((e) => {
        if (tokensRef.current.get(`thread::${key}`) !== token) return;
        const msg = (e as ApiCallError | Error).message;
        setThreads((s) => ({ ...s, [key]: { loading: false, error: msg, savedAt: Date.now() } }));
        if (currentPRKeyRef.current !== prRef) {
          onToast('error', `Claude (thread) failed on ${prRef}: ${msg}`);
        }
      });
  }, [onToast]);

  const dismissSummary = useCallback((target: PRTarget) => {
    const key = prKey(target);
    // bump the token so any in-flight resolution is dropped — a dismiss is an
    // explicit "I don't care about the result anymore" signal.
    tokensRef.current.set(`summary::${key}`, (tokensRef.current.get(`summary::${key}`) ?? 0) + 1);
    setSummary((s) => { const next = { ...s }; delete next[key]; return next; });
  }, []);

  const dismissThread = useCallback((target: PRTarget, threadId: string) => {
    const key = threadKey(target, threadId);
    tokensRef.current.set(`thread::${key}`, (tokensRef.current.get(`thread::${key}`) ?? 0) + 1);
    setThreads((s) => { const next = { ...s }; delete next[key]; return next; });
  }, []);

  /** Drop every Claude entry tied to a PR — summary + all thread replies for that PR.
   * Used when the user deletes a PR from a tracked list so we don't carry stale
   * Claude state around for PRs they're no longer following. */
  const dismissAllForPR = useCallback((target: PRTarget) => {
    const sKey = prKey(target);
    const tPrefix = `${sKey}::`;
    // Bump tokens for any in-flight requests so their resolutions get dropped.
    tokensRef.current.set(`summary::${sKey}`, (tokensRef.current.get(`summary::${sKey}`) ?? 0) + 1);
    setSummary((s) => { const next = { ...s }; delete next[sKey]; return next; });
    setThreads((s) => {
      const next: Record<string, ClaudeResponseState> = {};
      for (const [k, v] of Object.entries(s)) {
        if (k.startsWith(tPrefix)) {
          tokensRef.current.set(`thread::${k}`, (tokensRef.current.get(`thread::${k}`) ?? 0) + 1);
          continue;
        }
        next[k] = v;
      }
      return next;
    });
  }, []);

  /** Pick out the state slice relevant to a single PR. */
  const summaryFor = useCallback((target: PRTarget): ClaudeResponseState | null => summary[prKey(target)] ?? null, [summary]);
  const threadFor = useCallback((target: PRTarget, threadId: string): ClaudeResponseState | null => threads[threadKey(target, threadId)] ?? null, [threads]);

  return { summaryFor, threadFor, askSummary, askThread, dismissSummary, dismissThread, dismissAllForPR };
}

/** Test-only: clear both storage buckets. Exported so tests don't leak across runs. */
export function __resetClaudeResponseStorage(): void {
  try {
    localStorage.removeItem(SUMMARY_STORAGE_KEY);
    localStorage.removeItem(THREAD_STORAGE_KEY);
  } catch { /* ignore */ }
}
