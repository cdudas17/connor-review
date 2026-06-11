import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiCallError } from '../lib/api.js';
import type { ClaudeResponseState } from '../components/ClaudeResponseCard.js';

interface PRTarget { owner: string; repo: string; number: number; }
interface LineRange { path: string; startLine?: number; endLine: number; side: 'LEFT' | 'RIGHT' }

export interface ClaudeChatTurn {
  role: 'user' | 'claude';
  body: string;
  ts: number;
  /** True only on the latest claude turn while in-flight; cleared on settle. Never persisted. */
  loading?: boolean;
  /** Set on a claude turn that failed. */
  error?: string;
  /** Set on a claude turn whose prompt had a truncated diff. Display-only. */
  truncatedDiff?: boolean;
}

export interface ClaudeChat {
  turns: ClaudeChatTurn[];
  /** Epoch ms when this chat was last updated. Drives sweep + LRU. */
  savedAt: number;
}

/** Persisted-chat storage. Replaces the old per-PR summary card store. */
const CHAT_STORAGE_KEY = 'connor-review.claudeChat.v1';
/** Legacy summary card store (single response per PR). Read once at boot and
 * migrated into the new chat shape (single claude turn), then ignored. */
const LEGACY_SUMMARY_STORAGE_KEY = 'connor-review.claudeSummary.v1';
const THREAD_STORAGE_KEY = 'connor-review.claudeThread.v1';

/** Drop persisted responses older than this on hook mount. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 200;

function prKey(p: PRTarget): string { return `${p.owner}/${p.repo}#${p.number}`; }
function threadKey(p: PRTarget, threadId: string): string { return `${prKey(p)}::${threadId}`; }

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function loadChats(): Record<string, ClaudeChat> {
  const direct = loadJson<Record<string, ClaudeChat>>(CHAT_STORAGE_KEY, {});
  if (Object.keys(direct).length > 0) return direct;
  // Migrate any legacy single-card entries on first run.
  const legacy = loadJson<Record<string, ClaudeResponseState & { savedAt?: number }>>(LEGACY_SUMMARY_STORAGE_KEY, {});
  const migrated: Record<string, ClaudeChat> = {};
  for (const [key, v] of Object.entries(legacy)) {
    if (v.loading) continue;
    if (!v.body && !v.error) continue;
    const ts = v.savedAt ?? Date.now();
    migrated[key] = {
      savedAt: ts,
      turns: [
        // The legacy single-card stored only Claude's response — we don't have
        // the user's original prompt. Render as a Claude turn with a marker so
        // the user knows what it is.
        { role: 'claude', body: v.body ?? '', ts, truncatedDiff: v.truncatedDiff, error: v.error },
      ],
    };
  }
  return migrated;
}

function persistChats(store: Record<string, ClaudeChat>) {
  try {
    // Drop transient `loading` flags from any claude turn before persisting —
    // a loading request that's lost on reload would otherwise stay stuck.
    const stable: Record<string, ClaudeChat> = {};
    for (const [k, v] of Object.entries(store)) {
      stable[k] = {
        savedAt: v.savedAt,
        turns: v.turns.map((t) => (t.loading ? { ...t, loading: false } : t)),
      };
    }
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(stable));
  } catch { /* quota — ignore */ }
}

function loadStore(key: string): Record<string, ClaudeResponseState> {
  return loadJson<Record<string, ClaudeResponseState>>(key, {});
}

function persistStore(key: string, store: Record<string, ClaudeResponseState>) {
  try {
    const stable: Record<string, ClaudeResponseState> = {};
    for (const [k, v] of Object.entries(store)) {
      if (v.loading) continue;
      stable[k] = v;
    }
    localStorage.setItem(key, JSON.stringify(stable));
  } catch { /* ignore */ }
}

function sweepStore<T extends { savedAt?: number }>(store: Record<string, T>, now: number): Record<string, T> {
  const cutoff = now - MAX_AGE_MS;
  const fresh: Array<[string, T]> = [];
  for (const [k, v] of Object.entries(store)) {
    if (v.savedAt != null && v.savedAt < cutoff) continue;
    fresh.push([k, v]);
  }
  if (fresh.length <= MAX_ENTRIES) return Object.fromEntries(fresh);
  fresh.sort((a, b) => (a[1].savedAt ?? 0) - (b[1].savedAt ?? 0));
  return Object.fromEntries(fresh.slice(fresh.length - MAX_ENTRIES));
}

interface Options {
  onToast: (kind: 'success' | 'error' | 'info', message: string) => void;
  currentPRKey: string | null;
}

/** Centralised Claude state for the drawer's "Ask Claude" surfaces.
 *
 * - **Chat panel** (one per PR): a multi-turn conversation. Replaces what used
 *   to be the single summary response card. Persisted across drawer close, PR
 *   navigation, and page reload. Follow-up turns send the full history.
 * - **Thread reply cards** (one per PR + thread id): single-shot, persisted.
 * - **Inline composer cards**: ephemeral, not owned here.
 *
 * In-flight requests survive drawer close. When a response lands and the drawer
 * is no longer on that PR, we toast so the user knows to reopen. */
export function useClaudeResponses(opts: Options) {
  const { onToast, currentPRKey } = opts;
  const [chats, setChats] = useState<Record<string, ClaudeChat>>(() => sweepStore(loadChats(), Date.now()));
  const [threads, setThreads] = useState<Record<string, ClaudeResponseState>>(() => sweepStore(loadStore(THREAD_STORAGE_KEY), Date.now()));

  const tokensRef = useRef<Map<string, number>>(new Map());
  const currentPRKeyRef = useRef<string | null>(currentPRKey);
  useEffect(() => { currentPRKeyRef.current = currentPRKey; }, [currentPRKey]);

  // Ref-mirror of chats so the synchronous part of askInChat can read the
  // latest turns without going through a state-updater (React 18 batches the
  // updater, which means it runs AFTER `api.askClaude` is called otherwise).
  const chatsRef = useRef<Record<string, ClaudeChat>>(chats);
  useEffect(() => { chatsRef.current = chats; }, [chats]);

  useEffect(() => { persistChats(chats); }, [chats]);
  useEffect(() => { persistStore(THREAD_STORAGE_KEY, threads); }, [threads]);

  /** Append a user message to the PR's chat, fire Claude with the full history,
   * and stream the resolved reply into a claude turn. Token-guarded — a second
   * ask while the first is still in flight discards the older resolution. */
  const askInChat = useCallback((target: PRTarget, userMessage: string) => {
    const trimmed = userMessage.trim();
    if (!trimmed) return;
    const key = prKey(target);
    const token = (tokensRef.current.get(`chat::${key}`) ?? 0) + 1;
    tokensRef.current.set(`chat::${key}`, token);

    // Read existing turns from the ref synchronously — state-updater runs
    // later under React 18 batching, which would race with api.askClaude below.
    const existing = chatsRef.current[key];
    const priorTurns: ClaudeChatTurn[] = existing?.turns.filter((t) => !t.loading) ?? [];
    const now = Date.now();
    setChats((c) => {
      const cur = c[key];
      const baseTurns = cur?.turns.filter((t) => !t.loading) ?? [];
      return {
        ...c,
        [key]: {
          savedAt: now,
          turns: [
            ...baseTurns,
            { role: 'user', body: trimmed, ts: now },
            { role: 'claude', body: '', ts: now, loading: true },
          ],
        },
      };
    });

    api.askClaude(target.owner, target.repo, target.number, {
      draft: trimmed,
      conversation: priorTurns.map((t) => ({ role: t.role, body: t.body })),
    })
      .then((res) => {
        if (tokensRef.current.get(`chat::${key}`) !== token) return;
        setChats((c) => {
          const cur = c[key];
          if (!cur) return c;
          // Replace the trailing loading claude turn with the resolved one.
          const turns = cur.turns.map((t, i) =>
            i === cur.turns.length - 1 && t.role === 'claude' && t.loading
              ? { ...t, loading: false, body: res.response, truncatedDiff: res.truncatedDiff, ts: Date.now() }
              : t);
          return { ...c, [key]: { savedAt: Date.now(), turns } };
        });
        if (currentPRKeyRef.current !== key) {
          onToast('info', `Claude answered on ${key} — reopen to see it`);
        }
      })
      .catch((e) => {
        if (tokensRef.current.get(`chat::${key}`) !== token) return;
        const msg = (e as ApiCallError | Error).message;
        setChats((c) => {
          const cur = c[key];
          if (!cur) return c;
          const turns = cur.turns.map((t, i) =>
            i === cur.turns.length - 1 && t.role === 'claude' && t.loading
              ? { ...t, loading: false, error: msg, ts: Date.now() }
              : t);
          return { ...c, [key]: { savedAt: Date.now(), turns } };
        });
        if (currentPRKeyRef.current !== key) {
          onToast('error', `Claude failed for ${key}: ${msg}`);
        }
      });
  }, [onToast]);

  const dismissChat = useCallback((target: PRTarget) => {
    const key = prKey(target);
    tokensRef.current.set(`chat::${key}`, (tokensRef.current.get(`chat::${key}`) ?? 0) + 1);
    setChats((c) => { const next = { ...c }; delete next[key]; return next; });
  }, []);

  // Thread reply Claude state — unchanged single-shot per (PR, threadId).
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

  const dismissThread = useCallback((target: PRTarget, threadId: string) => {
    const key = threadKey(target, threadId);
    tokensRef.current.set(`thread::${key}`, (tokensRef.current.get(`thread::${key}`) ?? 0) + 1);
    setThreads((s) => { const next = { ...s }; delete next[key]; return next; });
  }, []);

  /** Drop every Claude entry tied to a PR — chat + all thread replies. */
  const dismissAllForPR = useCallback((target: PRTarget) => {
    const sKey = prKey(target);
    const tPrefix = `${sKey}::`;
    tokensRef.current.set(`chat::${sKey}`, (tokensRef.current.get(`chat::${sKey}`) ?? 0) + 1);
    setChats((c) => { const next = { ...c }; delete next[sKey]; return next; });
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

  const chatFor = useCallback((target: PRTarget): ClaudeChat | null => chats[prKey(target)] ?? null, [chats]);
  const threadFor = useCallback((target: PRTarget, threadId: string): ClaudeResponseState | null => threads[threadKey(target, threadId)] ?? null, [threads]);

  /** Aggregate state for the PR-list row badge. Inspects chat turns + every
   * thread card for the PR. Priority: loading > error > success > none. */
  const aggregateFor = useCallback((target: PRTarget): { kind: 'loading' | 'error' | 'success' } | null => {
    const prefix = prKey(target);
    const chat = chats[prefix];
    let anyLoading = false;
    let anyError = false;
    let anyBody = false;
    if (chat) {
      for (const t of chat.turns) {
        if (t.loading) anyLoading = true;
        if (t.error) anyError = true;
        if (t.role === 'claude' && t.body && !t.error) anyBody = true;
      }
    }
    const threadPrefix = `${prefix}::`;
    for (const [k, v] of Object.entries(threads)) {
      if (!k.startsWith(threadPrefix)) continue;
      if (v.loading) anyLoading = true;
      if (v.error) anyError = true;
      if (v.body && !v.error) anyBody = true;
    }
    if (!chat && !Object.keys(threads).some((k) => k.startsWith(threadPrefix))) return null;
    if (anyLoading) return { kind: 'loading' };
    if (anyError && !anyBody) return { kind: 'error' };
    return { kind: 'success' };
  }, [chats, threads]);

  return { chatFor, threadFor, aggregateFor, askInChat, askThread, dismissChat, dismissThread, dismissAllForPR };
}

/** Test-only: clear all storage buckets. */
export function __resetClaudeResponseStorage(): void {
  try {
    localStorage.removeItem(CHAT_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SUMMARY_STORAGE_KEY);
    localStorage.removeItem(THREAD_STORAGE_KEY);
  } catch { /* ignore */ }
}
