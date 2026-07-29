export type InventoryDedupeMode = 'snapshot_only' | 'drafts_fill_gap' | 'sum_both';

export type InventoryPositionBucket =
  | 'available'
  | 'inProduction'
  | 'inTransit'
  | 'confirmedOpen'
  | 'reserved'
  | 'backorder';

export type InventoryPositionSource = {
  source: 'snapshot' | 'purchase_draft';
  bucket: InventoryPositionBucket;
  qty: number;
  draftId?: string;
  atRisk?: boolean;
};

export type InventoryPositionBreakdown = {
  qtyAvailable: number;
  qtyInProduction: number;
  qtyInTransit: number;
  qtyConfirmedOpen: number;
  qtyReserved: number;
  qtyBackorder: number;
  effectiveQty: number;
  sources: InventoryPositionSource[];
  dedupeMode: InventoryDedupeMode;
  unassignedOpenQty: number;
};

export function openDraftQty(qty: number, receivedQty: number): number {
  return Math.max(0, (qty ?? 0) - (receivedQty ?? 0));
}

export function mapDraftStatusToBucket(status: string): InventoryPositionBucket | null {
  switch (status) {
    case 'draft':
    case 'confirmed':
    case 'exception':
      return 'confirmedOpen';
    case 'in_production':
    case 'ready_to_ship':
      return 'inProduction';
    case 'in_transit':
    case 'partial_received':
      return 'inTransit';
    default:
      return null;
  }
}

export function mergeInventoryPosition(input: {
  dedupeMode?: InventoryDedupeMode;
  snapshot: {
    qtyAvailable: number;
    qtyInTransit: number;
    qtyInProduction: number;
    qtyReserved: number;
  };
  draftBuckets: {
    inProduction: number;
    inTransit: number;
    confirmedOpen: number;
  };
  sources?: InventoryPositionSource[];
  unassignedOpenQty?: number;
}): InventoryPositionBreakdown {
  const dedupeMode = input.dedupeMode ?? 'drafts_fill_gap';
  const s = input.snapshot;
  const d = input.draftBuckets;

  let qtyInProduction = s.qtyInProduction;
  let qtyInTransit = s.qtyInTransit;
  let qtyConfirmedOpen = 0;

  if (dedupeMode === 'snapshot_only') {
    // drafts ignored for bucket totals
  } else if (dedupeMode === 'sum_both') {
    qtyInProduction += d.inProduction;
    qtyInTransit += d.inTransit;
    qtyConfirmedOpen = d.confirmedOpen;
  } else {
    // drafts_fill_gap
    if (qtyInProduction <= 0) qtyInProduction = d.inProduction;
    if (qtyInTransit <= 0) qtyInTransit = d.inTransit;
    qtyConfirmedOpen = d.confirmedOpen;
  }

  const qtyAvailable = s.qtyAvailable;
  const qtyReserved = s.qtyReserved;
  const qtyBackorder = 0;
  const effectiveQty =
    qtyAvailable + qtyInProduction + qtyInTransit + qtyConfirmedOpen - qtyReserved - qtyBackorder;

  return {
    qtyAvailable,
    qtyInProduction,
    qtyInTransit,
    qtyConfirmedOpen,
    qtyReserved,
    qtyBackorder,
    effectiveQty,
    sources: input.sources ?? [],
    dedupeMode,
    unassignedOpenQty: input.unassignedOpenQty ?? 0,
  };
}
