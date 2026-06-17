import { useState } from 'react';

interface Props {
  selectedCount: number;
  totalVisible: number;
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  /** Bulk-delete from the tracked PR bucket. Optional — only the Added /
   * mineAdded surfaces ever own enough state to remove a row entirely. */
  onDelete?: () => void;
  /** Bulk-copy GitHub URLs as newline-separated text. Always available
   * whenever the bar is visible. */
  onCopyLinks?: () => Promise<void> | void;
}

export function BulkActionsBar({ selectedCount, totalVisible, allSelected, onSelectAll, onClear, onDelete, onCopyLinks }: Props) {
  const [copied, setCopied] = useState(false);
  if (selectedCount === 0) return null;
  const handleCopy = async () => {
    if (!onCopyLinks) return;
    await onCopyLinks();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="bulk-actions-bar" role="toolbar" aria-label="Bulk actions">
      <span className="bulk-actions-count">{selectedCount} of {totalVisible} selected</span>
      <div className="bulk-actions-buttons">
        {!allSelected && (
          <button type="button" onClick={onSelectAll}>Select all {totalVisible}</button>
        )}
        <button type="button" onClick={onClear}>Clear</button>
        {onCopyLinks && (
          <button type="button" className={copied ? 'btn-copied' : ''} onClick={handleCopy}>
            {copied ? 'Copied!' : `Copy ${selectedCount === 1 ? 'link' : `${selectedCount} links`}`}
          </button>
        )}
        {onDelete && (
          <button type="button" className="btn-danger" onClick={onDelete}>
            Delete {selectedCount === 1 ? 'PR' : `${selectedCount} PRs`}
          </button>
        )}
      </div>
    </div>
  );
}
