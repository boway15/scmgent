import { ProcurementBitableListPage } from './ProcurementBitableListPage';

export function BulkStockRequestPage() {
  return (
    <ProcurementBitableListPage
      listType="bulk_stock_request"
      title="大件备货申请"
      description="从飞书多维表格同步或上传 CSV/XLSX，每次操作将全量覆盖当前列表。"
    />
  );
}

export function ProcurementFollowUpPage() {
  return (
    <ProcurementBitableListPage
      listType="purchase_follow_up"
      title="采购跟单"
      description="从飞书多维表格同步或上传 CSV/XLSX，每次操作将全量覆盖当前列表。与「下单计划 > 采购跟单」的内部履约台账相互独立。"
    />
  );
}
