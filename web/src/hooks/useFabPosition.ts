import { useCallback, useEffect, useState } from 'react';

const FAB_SIZE = 44;
const PAD = 12; // keep at least this many px from the viewport edge

export interface FabPosition { x: number; y: number; }

interface Options {
  /** localStorage key for this FAB's position. Each FAB needs its own key so
   * they don't fight over the same coordinates. Defaults to the notes FAB key
   * for back-compat. */
  storageKey?: string;
  /** Default position when nothing is persisted yet. */
  defaultPosition?: (viewport: { w: number; h: number }) => FabPosition;
}

const DEFAULT_STORAGE_KEY = 'connor-review.notesFabPosition.v1';

function viewport() {
  return {
    w: typeof window === 'undefined' ? 1024 : window.innerWidth,
    h: typeof window === 'undefined' ? 768 : window.innerHeight,
  };
}

function defaultBottomLeft(): FabPosition {
  const { h } = viewport();
  return { x: 20, y: h - FAB_SIZE - 20 };
}

function clamp(pos: FabPosition): FabPosition {
  const { w, h } = viewport();
  return {
    x: Math.max(PAD, Math.min(pos.x, w - FAB_SIZE - PAD)),
    y: Math.max(PAD, Math.min(pos.y, h - FAB_SIZE - PAD)),
  };
}

function load(storageKey: string, fallback: () => FabPosition): FabPosition {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return fallback();
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
      return clamp(parsed);
    }
  } catch { /* ignore */ }
  return fallback();
}

/**
 * Tracks a floating FAB's screen position. Persists to localStorage (per
 * `storageKey`) and clamps to the visible viewport on load + on resize so the
 * button can't be stranded off-screen. Default `storageKey` matches the
 * original notes FAB for back-compat.
 */
export function useFabPosition(opts: Options = {}) {
  const storageKey = opts.storageKey ?? DEFAULT_STORAGE_KEY;
  const fallback = useCallback(
    () => clamp((opts.defaultPosition ?? (() => defaultBottomLeft()))(viewport())),
    // The fallback can read window dimensions but is only invoked from
    // initial state + resize, both safe.
    [opts.defaultPosition],
  );
  const [pos, setPos] = useState<FabPosition>(() => load(storageKey, fallback));

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(pos)); } catch { /* ignore */ }
  }, [storageKey, pos]);

  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const setClamped = useCallback((next: FabPosition) => setPos(clamp(next)), []);

  return { pos, setPos: setClamped };
}
