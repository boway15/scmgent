type Props = {
  isStale?: boolean;
  selectedSnapshotDate?: string | null;
  syncedAt?: string | null;
  emptyMessage: string;
};

/** 库存查询三 Tab 共用的快照状态文案（Token 对齐库存周转） */
export function InventorySnapshotStatusLine({
  isStale,
  selectedSnapshotDate,
  syncedAt,
  emptyMessage,
}: Props) {
  if (isStale && selectedSnapshotDate) {
    return (
      <span className="text-amber-800">
        今日尚未成功同步，当前展示 {selectedSnapshotDate} 快照
        {syncedAt ? `（同步于 ${new Date(syncedAt).toLocaleString()}）` : ''}
      </span>
    );
  }
  if (syncedAt && selectedSnapshotDate) {
    return (
      <span className="text-text-sub">
        快照 {selectedSnapshotDate}，同步于 {new Date(syncedAt).toLocaleString()}
      </span>
    );
  }
  return <span className="text-text-sub">{emptyMessage}</span>;
}
