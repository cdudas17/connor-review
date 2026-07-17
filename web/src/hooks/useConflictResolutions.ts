import { useCallback, useEffect, useRef, useState } from 'react';

/** Persistent per-PR state for the "ask Claude to resolve merge conflicts"
 * flow. Stored in its own localStorage bucket so that:
 *  1. AIBadge (which reads from useAIResponses) is never affected by
 *     conflict-resolution activity — per the user's explicit "don't count
 *     toward the Claude badge" rule.
 *  2. Failed attempts persist across drawer reopens / page reloads so the
 *     error message stays attached to the PR until the user dismisses it. */

interface PRTarget { owner: string; repo: string; number: number; }
function key(t: PRTarget) { return `${t.owner}/${t.repo}#${t.number}`; }

export interface ConflictResolutionEntry {
  kind: 'running' | 'failed' | 'success';
  /** Failure message surfaced to the drawer's failure card. */
  error?: string;
  /** Optional code passed through from the server (e.g. OVERCOMMIT_DETECTED). */
  code?: string;
  /** Successful merge commit SHA — used only to display a brief confirmation
   * before the next meta refetch clears the conflict state altogether. */
  commitSha?: string;
  /** Epoch ms. Drives the 30-day sweep + the LRU cap. */
  savedAt: number;
}

const STORAGE_KEY = 'connor-review.conflictResolutions.v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_ENTRIES = 200;

function loadStore(): Record<string, ConflictResolutionEntry> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed != null ? parsed : {};
  } catch { return {}; }
}

function saveStore(store: Record<string, ConflictResolutionEntry>) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(store)); }
  catch { /* quota exhausted; the sweep below keeps us bounded normally */ }
}

function sweep(store: Record<string, ConflictResolutionEntry>, now: number): Record<string, ConflictResolutionEntry> {
  const cutoff = now - MAX_AGE_MS;
  const fresh = Object.entries(store)
    .filter(([, v]) => (v.savedAt ?? 0) > cutoff)
    .sort(([, a], [, b]) => (a.savedAt ?? 0) - (b.savedAt ?? 0));
  if (fresh.length <= MAX_ENTRIES) return Object.fromEntries(fresh);
  return Object.fromEntries(fresh.slice(fresh.length - MAX_ENTRIES));
}

export function useConflictResolutions() {
  const [store, setStore] = useState<Record<string, ConflictResolutionEntry>>(() => sweep(loadStore(), Date.now()));
  // Mirror state synchronously so concurrent callers (e.g. row-click vs.
  // drawer Try-Again) can't read a stale React-batched view and double-fire.
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; }, [store]);

  useEffect(() => { saveStore(store); }, [store]);

  /** Per-PR in-flight guard — distinct from the persisted 'running' kind
   * because a server restart shouldn't make us think a request is still
   * in-flight on the next mount. */
  const inFlightRef = useRef<Set<string>>(new Set());

  const start = useCallback((t: PRTarget): boolean => {
    const k = key(t);
    if (inFlightRef.current.has(k)) return false;
    inFlightRef.current.add(k);
    setStore((prev) => ({
      ...prev,
      [k]: { kind: 'running', savedAt: Date.now() },
    }));
    return true;
  }, []);

  const finishOk = useCallback((t: PRTarget, commitSha: string) => {
    const k = key(t);
    inFlightRef.current.delete(k);
    setStore((prev) => ({
      ...prev,
      [k]: { kind: 'success', commitSha, savedAt: Date.now() },
    }));
  }, []);

  const finishErr = useCallback((t: PRTarget, message: string, code?: string) => {
    const k = key(t);
    inFlightRef.current.delete(k);
    setStore((prev) => ({
      ...prev,
      [k]: { kind: 'failed', error: message, code, savedAt: Date.now() },
    }));
  }, []);

  const dismiss = useCallback((t: PRTarget) => {
    const k = key(t);
    inFlightRef.current.delete(k);
    setStore((prev) => {
      const next = { ...prev };
      delete next[k];
      return next;
    });
  }, []);

  const stateFor = useCallback((t: PRTarget): ConflictResolutionEntry | null => {
    return store[key(t)] ?? null;
  }, [store]);

  return { start, finishOk, finishErr, dismiss, stateFor };
}
