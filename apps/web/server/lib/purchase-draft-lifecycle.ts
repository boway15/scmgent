export type PurchaseDraftStatus =
  | 'draft'
  | 'submitted'
  | 'confirmed'
  | 'in_production'
  | 'ready_to_ship'
  | 'in_transit'
  | 'partial_received'
  | 'received'
  | 'exception'
  | 'cancelled';

export const PURCHASE_DRAFT_STATUS_LABEL: Record<PurchaseDraftStatus, string> = {
  draft: '待确认',
  submitted: '已确认',
  confirmed: '已确认',
  in_production: '生产中',
  ready_to_ship: '待发货',
  in_transit: '在途',
  partial_received: '部分到货',
  received: '已收货',
  exception: '异常',
  cancelled: '已取消',
};

const VALID_TRANSITIONS: Record<PurchaseDraftStatus, PurchaseDraftStatus[]> = {
  draft: ['confirmed', 'exception', 'cancelled'],
  submitted: ['confirmed', 'exception', 'cancelled'],
  confirmed: ['in_production', 'exception', 'cancelled'],
  in_production: ['ready_to_ship', 'exception', 'cancelled'],
  ready_to_ship: ['in_transit', 'exception', 'cancelled'],
  in_transit: ['partial_received', 'received', 'exception'],
  partial_received: ['received', 'exception'],
  received: [],
  exception: ['confirmed', 'in_production', 'cancelled'],
  cancelled: [],
};

export function assertPurchaseDraftTransition(
  from: PurchaseDraftStatus,
  to: PurchaseDraftStatus,
): void {
  if (from === to) return;
  const allowed = VALID_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`无法从「${PURCHASE_DRAFT_STATUS_LABEL[from]}」转为「${PURCHASE_DRAFT_STATUS_LABEL[to]}」`);
  }
}

export function deriveReceiptStatus(
  receivedQty: number,
  plannedQty: number,
): 'partial_received' | 'received' {
  return receivedQty >= plannedQty ? 'received' : 'partial_received';
}

export function normalizePurchaseDraftStatus(status: string): PurchaseDraftStatus {
  if (status === 'submitted') return 'confirmed';
  return status as PurchaseDraftStatus;
}
