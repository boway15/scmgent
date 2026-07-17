import { ProcurementBitableListPage } from './ProcurementBitableListPage';

export function BulkStockRequestPage() {
  return (
    <ProcurementBitableListPage
      listType="bulk_stock_request"
      title="大件备货申请"
      description="预下单数据。列表字段固定；从飞书同步、同步到飞书或上传 CSV/XLSX 均为全量覆盖，不增删或重排列。"
    />
  );
}

export function ProcurementFollowUpPage() {
  return (
    <ProcurementBitableListPage
      listType="purchase_follow_up"
      title="采购跟单"
      description="列表字段固定；从飞书同步、同步到飞书或上传 CSV/XLSX 均为全量覆盖，不增删或重排列。与「下单计划 > 采购跟单」的内部履约台账相互独立。"
    />
  );
}
