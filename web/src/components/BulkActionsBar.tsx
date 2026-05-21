interface Props {
  selectedCount: number;
  totalVisible: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onDelete: () => void;
}

export function BulkActionsBar({ selectedCount, totalVisible, allSelected, onSelectAll, onClear, onDelete }: Props) {
  if (selectedCount === 0) return null;
  return (
    <div className="bulk-actions-bar" role="toolbar" aria-label="Bulk actions">
      <span className="bulk-actions-count">{selectedCount} of {totalVisible} selected</span>
      <div className="bulk-actions-buttons">
        {!allSelected && (
          <button type="button" onClick={onSelectAll}>Select all {totalVisible}</button>
        )}
        <button type="button" onClick={onClear}>Clear</button>
        <button type="button" className="btn-danger" onClick={onDelete}>
          Delete {selectedCount === 1 ? 'PR' : `${selectedCount} PRs`}
        </button>
      </div>
    </div>
  );
}
