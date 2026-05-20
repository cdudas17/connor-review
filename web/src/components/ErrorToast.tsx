interface Props { message: string; onDismiss: () => void; }
export function ErrorToast({ message, onDismiss }: Props) {
  return (
    <div className="error-toast" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss}>×</button>
    </div>
  );
}
