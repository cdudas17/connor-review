import { useCallback, useRef, useState } from 'react';

export type ToastKind = 'success' | 'error' | 'info';
export interface Toast { id: number; kind: ToastKind; message: string; }

const AUTO_DISMISS_MS: Record<ToastKind, number> = {
  success: 3500,
  info: 4000,
  error: 7000,
};

/**
 * Lightweight toast queue. Pass `addToast(kind, message)` to anything that needs
 * to fire transient notifications; pass the `toasts` + `dismissToast` to
 * <ToastStack/> to render them.
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const addToast = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setToasts((cur) => [...cur, { id, kind, message }]);
    setTimeout(() => {
      setToasts((cur) => cur.filter((t) => t.id !== id));
    }, AUTO_DISMISS_MS[kind]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, dismissToast };
}
