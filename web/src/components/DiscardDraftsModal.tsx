interface Props {
  open: boolean;
  onDiscard: () => void;
  onCancel: () => void;
}

export function DiscardDraftsModal({ open, onDiscard, onCancel }: Props) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h3>Discard unsent comments?</h3>
        <p>You have unsent comments on this PR. Moving on will discard them.</p>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="button" onClick={onDiscard}>Discard</button>
        </div>
      </div>
    </div>
  );
}
