import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import type { ClaudeResponseState } from '../components/ClaudeResponseCard.js';

interface PRTarget { owner: string; repo: string; number: number; }
interface LineRange { path: string; startLine?: number; endLine: number; side: 'LEFT' | 'RIGHT' }

const SUMMARY_STORAGE_KEY = 'connor-review.claudeSummary.v1';
const THREAD_STORAGE_KEY = 'connor-review.claudeThread.v1';

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
  const [summary, setSummary] = useState<Record<string, ClaudeResponseState>>(() => loadStore(SUMMARY_STORAGE_KEY));
  const [threads, setThreads] = useState<Record<string, ClaudeResponseState>>(() => loadStore(THREAD_STORAGE_KEY));

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
        setSummary((s) => ({ ...s, [key]: { loading: false, body: res.response, truncatedDiff: res.truncatedDiff } }));
        if (currentPRKeyRef.current !== key) {
          onToast('info', `Claude answered on ${key} — reopen to see it`);
        }
      })
      .catch((e) => {
        if (tokensRef.current.get(`summary::${key}`) !== token) return;
        const msg = (e as ApiCallError | Error).message;
        setSummary((s) => ({ ...s, [key]: { loading: false, error: msg } }));
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
        setThreads((s) => ({ ...s, [key]: { loading: false, body: res.response, truncatedDiff: res.truncatedDiff } }));
        if (currentPRKeyRef.current !== prRef) {
          onToast('info', `Claude answered a thread on ${prRef} — reopen to see it`);
        }
      })
      .catch((e) => {
        if (tokensRef.current.get(`thread::${key}`) !== token) return;
        const msg = (e as ApiCallError | Error).message;
        setThreads((s) => ({ ...s, [key]: { loading: false, error: msg } }));
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

  /** Pick out the state slice relevant to a single PR. */
  const summaryFor = useCallback((target: PRTarget): ClaudeResponseState | null => summary[prKey(target)] ?? null, [summary]);
  const threadFor = useCallback((target: PRTarget, threadId: string): ClaudeResponseState | null => threads[threadKey(target, threadId)] ?? null, [threads]);

  return { summaryFor, threadFor, askSummary, askThread, dismissSummary, dismissThread };
}

/** Test-only: clear both storage buckets. Exported so tests don't leak across runs. */
export function __resetClaudeResponseStorage(): void {
  try {
    localStorage.removeItem(SUMMARY_STORAGE_KEY);
    localStorage.removeItem(THREAD_STORAGE_KEY);
  } catch { /* ignore */ }
}
