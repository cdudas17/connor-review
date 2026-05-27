import type { Toast } from '../hooks/useToasts.js';

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

export function ToastStack({ toasts, onDismiss }: Props) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} role="status">
          <span className="toast-message">{t.message}</span>
          <button type="button" onClick={() => onDismiss(t.id)} aria-label="Dismiss" className="toast-dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
