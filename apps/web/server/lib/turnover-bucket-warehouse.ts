/** 周转表分区后缀 → 运营仓 code（与调拨分仓对齐，禁止合并为 FOB 汇总仓） */
export const TURNOVER_BUCKET_WAREHOUSE_MAP: Record<string, string> = {
  美东: 'US-EAST',
  美南: 'US-SOUTH',
  美西: 'US-WEST',
  美中: 'US-CENTRAL',
  美东南: 'US-SOUTHEAST',
  德国: 'DE',
  平台仓_美: 'PLATFORM-US',
  平台仓_欧: 'PLATFORM-EU',
};

const WAREHOUSE_TO_OVERSEAS_SUFFIX = new Map(
  Object.entries(TURNOVER_BUCKET_WAREHOUSE_MAP).map(([suffix, warehouse]) => [
    warehouse,
    `海外仓库存_${suffix}`,
  ]),
);

const WAREHOUSE_TO_TRANSIT_SUFFIX = new Map(
  Object.entries(TURNOVER_BUCKET_WAREHOUSE_MAP).map(([suffix, warehouse]) => [
    warehouse,
    `调拨在途_${suffix}`,
  ]),
);

function parseQty(value: string | undefined): number {
  const parsed = parseInt(String(value ?? '').replace(/,/g, ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '_');
}

function pickRowQty(row: Record<string, string>, ...aliases: string[]): number {
  const normalized = new Set(aliases.map(normalizeKey));
  for (const [key, value] of Object.entries(row)) {
    if (normalized.has(normalizeKey(key))) return parseQty(value);
  }
  return 0;
}

export type TurnoverWarehouseBucket = {
  warehouse: string;
  qtyAvailable: number;
  qtyInTransit: number;
};

/** 从周转表行解析各分区仓可售/在途，不按 SKU 或区域合并 */
export function parseTurnoverWarehouseBuckets(row: Record<string, string>): TurnoverWarehouseBucket[] {
  const buckets = new Map<string, TurnoverWarehouseBucket>();

  const ensure = (warehouse: string): TurnoverWarehouseBucket => {
    const existing = buckets.get(warehouse);
    if (existing) return existing;
    const created = { warehouse, qtyAvailable: 0, qtyInTransit: 0 };
    buckets.set(warehouse, created);
    return created;
  };

  for (const [suffix, warehouse] of Object.entries(TURNOVER_BUCKET_WAREHOUSE_MAP)) {
    const overseas = pickRowQty(row, `海外仓库存_${suffix}`);
    const transit = pickRowQty(row, `调拨在途_${suffix}`);
    if (overseas === 0 && transit === 0) continue;
    const bucket = ensure(warehouse);
    bucket.qtyAvailable += overseas;
    bucket.qtyInTransit += transit;
  }

  for (const [key, value] of Object.entries(row)) {
    if (key.startsWith('海外仓库存_') && !key.endsWith('合计')) {
      const suffix = key.slice('海外仓库存_'.length);
      if (TURNOVER_BUCKET_WAREHOUSE_MAP[suffix]) continue;
      const warehouse = `BUCKET-${suffix}`;
      ensure(warehouse).qtyAvailable += parseQty(value);
    }
    if (key.startsWith('调拨在途_') && !key.endsWith('合计')) {
      const suffix = key.slice('调拨在途_'.length);
      if (TURNOVER_BUCKET_WAREHOUSE_MAP[suffix]) continue;
      const warehouse = `BUCKET-${suffix}`;
      ensure(warehouse).qtyInTransit += parseQty(value);
    }
  }

  return Array.from(buckets.values());
}

export type WarehouseStockLine = {
  warehouseCode: string;
  qtyAvailable: number;
  qtyInTransit: number;
};

/** 将分仓库存映射回周转表列名（仅当导入快照缺失时作展示兜底） */
export function warehouseStockToTurnoverColumnValue(
  stocks: WarehouseStockLine[] | undefined,
  columnId: string,
): string | null {
  if (!stocks?.length) return null;

  for (const stock of stocks) {
    const overseasCol = WAREHOUSE_TO_OVERSEAS_SUFFIX.get(stock.warehouseCode);
    if (overseasCol === columnId && stock.qtyAvailable > 0) {
      return String(stock.qtyAvailable);
    }
    const transitCol = WAREHOUSE_TO_TRANSIT_SUFFIX.get(stock.warehouseCode);
    if (transitCol === columnId && stock.qtyInTransit > 0) {
      return String(stock.qtyInTransit);
    }
  }
  return null;
}

export function isTurnoverInventoryQuantityColumn(columnId: string): boolean {
  return (
    columnId.startsWith('海外仓库存_') ||
    columnId.startsWith('调拨在途_') ||
    columnId.startsWith('已调拨未在途_') ||
    columnId.includes('供应商订单') ||
    columnId === '预下单' ||
    columnId === '全链条合计库存' ||
    columnId.startsWith('预计') && columnId.includes('上架')
  );
}
