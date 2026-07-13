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
  /** Keep the toolbar visible even with zero selection. On the Added PRs
   *  tab the "Select all N" affordance should always be reachable so the
   *  user doesn't have to check a box first to discover it. Selection-
   *  gated actions (Clear/Copy/Delete) collapse away at 0. */
  alwaysShow?: boolean;
}

export function BulkActionsBar({ selectedCount, totalVisible, allSelected, onSelectAll, onClear, onDelete, onCopyLinks, alwaysShow }: Props) {
  const [copied, setCopied] = useState(false);
  if (selectedCount === 0 && !alwaysShow) return null;
  const handleCopy = async () => {
    if (!onCopyLinks) return;
    await onCopyLinks();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="bulk-actions-bar" role="toolbar" aria-label="Bulk actions">
      <span className="bulk-actions-count">
        {selectedCount === 0 ? `None of ${totalVisible} selected` : `${selectedCount} of ${totalVisible} selected`}
      </span>
      <div className="bulk-actions-buttons">
        {!allSelected && (
          <button type="button" onClick={onSelectAll}>Select all {totalVisible}</button>
        )}
        {selectedCount > 0 && (
          <button type="button" onClick={onClear}>Clear</button>
        )}
        {selectedCount > 0 && onCopyLinks && (
          <button type="button" className={copied ? 'btn-copied' : ''} onClick={handleCopy}>
            {copied ? 'Copied!' : `Copy ${selectedCount === 1 ? 'link' : `${selectedCount} links`}`}
          </button>
        )}
        {selectedCount > 0 && onDelete && (
          <button type="button" className="btn-danger" onClick={onDelete}>
            Delete {selectedCount === 1 ? 'PR' : `${selectedCount} PRs`}
          </button>
        )}
      </div>
    </div>
  );
}
