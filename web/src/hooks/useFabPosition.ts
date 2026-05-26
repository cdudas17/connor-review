import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'connor-review.notesFabPosition.v1';
const FAB_SIZE = 44;
const PAD = 12; // keep at least this many px from the viewport edge

export interface FabPosition { x: number; y: number; }

function defaultPosition(): FabPosition {
  // Bottom-left by default, with the same 20px inset the original CSS used.
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const h = typeof window === 'undefined' ? 768 : window.innerHeight;
  return { x: 20, y: h - FAB_SIZE - 20 };
  void w; // not used; keep destructured shape if we ever swap defaults
}

function clamp(pos: FabPosition): FabPosition {
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const h = typeof window === 'undefined' ? 768 : window.innerHeight;
  return {
    x: Math.max(PAD, Math.min(pos.x, w - FAB_SIZE - PAD)),
    y: Math.max(PAD, Math.min(pos.y, h - FAB_SIZE - PAD)),
  };
}

function load(): FabPosition {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPosition();
    const parsed = JSON.parse(raw);
    if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') {
      return clamp(parsed);
    }
  } catch { /* ignore */ }
  return defaultPosition();
}

/**
 * Tracks the floating notes FAB position. Persists to localStorage and clamps
 * to the visible viewport on load + on resize so the button can't be stranded
 * off-screen.
 */
export function useFabPosition() {
  const [pos, setPos] = useState<FabPosition>(() => load());

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(pos)); } catch { /* ignore */ }
  }, [pos]);

  useEffect(() => {
    const onResize = () => setPos((p) => clamp(p));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const setClamped = useCallback((next: FabPosition) => setPos(clamp(next)), []);

  return { pos, setPos: setClamped };
}
