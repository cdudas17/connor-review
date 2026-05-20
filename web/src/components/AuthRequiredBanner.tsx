export function AuthRequiredBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="auth-banner" role="status">
      <p>GitHub CLI is not authenticated. Run <code>gh auth login</code> and reload.</p>
      <button type="button" onClick={() => navigator.clipboard?.writeText('gh auth login')}>Copy command</button>
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}
