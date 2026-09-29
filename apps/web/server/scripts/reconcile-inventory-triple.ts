/**
 * 周转 records × 三池 lots × 影子 facts 三方对照
 *
 * 用法（在 apps/web 目录）：
 *   npx tsx server/scripts/reconcile-inventory-triple.ts --sku=SKU编码
 *   npx tsx server/scripts/reconcile-inventory-triple.ts --sku-id=uuid
 *   npx tsx server/scripts/reconcile-inventory-triple.ts --sku=SKU --date=2026-09-29
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, inventoryRecords, inventorySupplyLots, skus, warehouseStockFacts } from '@scm/db';
import { getShanghaiBusinessDate } from '../lib/inventory-daily-snapshot.js';
import {
  IN_PRODUCTION_WAREHOUSE,
  UNALLOCATED_TRANSIT_WAREHOUSE,
} from '../lib/inventory-constants.js';
import {
  allocateByShare,
  parseSharesFromSnapshot,
} from '../lib/inventory-share-allocation.js';
import { readTurnoverSnapshot } from '../lib/inventory-turnover-snapshot.js';
import { resolveInventoryPosition } from '../lib/inventory-position.js';

type TurnoverRow = {
  warehouse: string;
  qtyAvailable: number;
  qtyInTransit: number;
  qtyInProduction: number;
  qtyReserved: number;
  recordedDate: string;
};

type LotAgg = {
  warehouseCode: string;
  pool: string;
  qty: number;
  batchCount: number;
};

type FactAgg = {
  warehouseCode: string;
  bucket: string;
  qty: number;
  source: string;
};

function parseArgs(argv: string[]) {
  let skuCode: string | undefined;
  let skuId: string | undefined;
  let snapshotDate: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--sku=')) skuCode = arg.slice('--sku='.length).trim();
    else if (arg.startsWith('--sku-id=')) skuId = arg.slice('--sku-id='.length).trim();
    else if (arg.startsWith('--date=')) snapshotDate = arg.slice('--date='.length).trim();
  }
  return { skuCode, skuId, snapshotDate };
}

function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function fmtDiff(a: number, b: number) {
  const d = a - b;
  if (d === 0) return 'OK';
  return d > 0 ? `+${d}` : `${d}`;
}

async function loadLatestTurnoverByWarehouse(skuId: string): Promise<TurnoverRow[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (warehouse)
      warehouse AS "warehouse",
      COALESCE(qty_available, 0)::int AS "qtyAvailable",
      COALESCE(qty_in_transit, 0)::int AS "qtyInTransit",
      COALESCE(qty_in_production, 0)::int AS "qtyInProduction",
      COALESCE(qty_reserved, 0)::int AS "qtyReserved",
      recorded_date::text AS "recordedDate"
    FROM ${inventoryRecords}
    WHERE sku_id = ${skuId}::uuid
      AND source = 'import'
    ORDER BY warehouse, recorded_date DESC, created_at DESC
  `);
  return Array.from(rows as unknown as TurnoverRow[]);
}

async function loadOpenLotsAgg(skuId: string): Promise<LotAgg[]> {
  const rows = await db
    .select({
      warehouseCode: inventorySupplyLots.warehouseCode,
      pool: inventorySupplyLots.pool,
      qty: sql<number>`sum(${inventorySupplyLots.qty})::int`.as('qty'),
      batchCount: sql<number>`count(*)::int`.as('batchCount'),
    })
    .from(inventorySupplyLots)
    .where(and(eq(inventorySupplyLots.skuId, skuId), eq(inventorySupplyLots.status, 'open')))
    .groupBy(inventorySupplyLots.warehouseCode, inventorySupplyLots.pool);
  return rows.map((r) => ({
    warehouseCode: r.warehouseCode,
    pool: r.pool,
    qty: Number(r.qty),
    batchCount: Number(r.batchCount),
  }));
}

async function loadFactsAgg(skuId: string, snapshotDate: string): Promise<FactAgg[]> {
  const rows = await db
    .select({
      warehouseCode: warehouseStockFacts.warehouseCode,
      bucket: warehouseStockFacts.bucket,
      qty: warehouseStockFacts.qty,
      source: warehouseStockFacts.source,
    })
    .from(warehouseStockFacts)
    .where(
      and(
        eq(warehouseStockFacts.snapshotDate, snapshotDate),
        eq(warehouseStockFacts.skuId, skuId),
        eq(warehouseStockFacts.selected, true),
      ),
    );
  return rows;
}

function lotQty(lots: LotAgg[], warehouse: string, pool: string): number {
  return lots
    .filter((l) => l.warehouseCode === warehouse && l.pool === pool)
    .reduce((s, l) => s + l.qty, 0);
}

function factQty(facts: FactAgg[], warehouse: string, bucket: string): number {
  return facts
    .filter((f) => f.warehouseCode === warehouse && f.bucket === bucket)
    .reduce((s, f) => s + f.qty, 0);
}

function turnoverRow(map: Map<string, TurnoverRow>, wh: string): TurnoverRow {
  return (
    map.get(wh) ?? {
      warehouse: wh,
      qtyAvailable: 0,
      qtyInTransit: 0,
      qtyInProduction: 0,
      qtyReserved: 0,
      recordedDate: '—',
    }
  );
}

async function main() {
  const { skuCode, skuId: skuIdArg, snapshotDate: dateArg } = parseArgs(process.argv.slice(2));
  if (!skuCode && !skuIdArg) {
    console.error('请指定 --sku=编码 或 --sku-id=uuid');
    process.exit(1);
  }

  const [sku] = await db
    .select({ id: skus.id, code: skus.code, encodingMeta: skus.encodingMeta })
    .from(skus)
    .where(skuIdArg ? eq(skus.id, skuIdArg) : eq(skus.code, skuCode!))
    .limit(1);
  if (!sku) {
    console.error('未找到 SKU');
    process.exit(1);
  }

  const snapshotDate = dateArg ?? getShanghaiBusinessDate();
  const share = parseSharesFromSnapshot(readTurnoverSnapshot(sku.encodingMeta));

  const [turnover, lots, facts] = await Promise.all([
    loadLatestTurnoverByWarehouse(sku.id),
    loadOpenLotsAgg(sku.id),
    loadFactsAgg(sku.id, snapshotDate),
  ]);

  const turnoverMap = new Map(turnover.map((r) => [r.warehouse, r]));
  const overseas = turnoverRow(turnoverMap, UNALLOCATED_TRANSIT_WAREHOUSE);
  const inProd = turnoverRow(turnoverMap, IN_PRODUCTION_WAREHOUSE);

  const physicalWarehouses = new Set<string>();
  for (const r of turnover) {
    if (r.warehouse !== UNALLOCATED_TRANSIT_WAREHOUSE && r.warehouse !== IN_PRODUCTION_WAREHOUSE) {
      physicalWarehouses.add(r.warehouse);
    }
  }
  for (const l of lots) {
    if (l.warehouseCode !== UNALLOCATED_TRANSIT_WAREHOUSE && l.warehouseCode !== IN_PRODUCTION_WAREHOUSE) {
      physicalWarehouses.add(l.warehouseCode);
    }
  }
  for (const f of facts) {
    physicalWarehouses.add(f.warehouseCode);
  }

  console.log('=== 三方对照：周转 × 三池 × 影子 ===');
  console.log(`SKU: ${sku.code} (${sku.id})`);
  console.log(`影子长表业务日: ${snapshotDate}`);
  console.log(
    `销售占比: ${share.method}${share.method === 'sales_share' ? ` (合计 ${share.shareSum})` : ''}`,
  );
  console.log('');

  console.log('--- A. 周转最新行 (inventory_records, source=import) ---');
  console.log(
    pad('仓', 16) +
      pad('可售', 8) +
      pad('在途', 8) +
      pad('在产', 8) +
      pad('预留', 8) +
      '快照日',
  );
  for (const r of [...turnover].sort((a, b) => a.warehouse.localeCompare(b.warehouse))) {
    console.log(
      pad(r.warehouse, 16) +
        pad(String(r.qtyAvailable), 8) +
        pad(String(r.qtyInTransit), 8) +
        pad(String(r.qtyInProduction), 8) +
        pad(String(r.qtyReserved), 8) +
        r.recordedDate,
    );
  }
  console.log('');

  console.log('--- B. 三池开放批次 (inventory_supply_lots, status=open) ---');
  if (!lots.length) console.log('(无 open 批次)');
  else {
    console.log(pad('仓', 16) + pad('池', 12) + pad('数量', 8) + '批次数');
    for (const l of [...lots].sort((a, b) =>
      `${a.warehouseCode}:${a.pool}`.localeCompare(`${b.warehouseCode}:${b.pool}`),
    )) {
      console.log(
        pad(l.warehouseCode, 16) + pad(l.pool, 12) + pad(String(l.qty), 8) + String(l.batchCount),
      );
    }
  }
  console.log('');

  console.log('--- C. 影子长表 selected=true ---');
  if (!facts.length) {
    console.log(`(当日 ${snapshotDate} 无 selected 事实行；检查查询/全链快照是否已发布、流水线是否跑完)`);
  } else {
    console.log(pad('仓', 16) + pad('bucket', 22) + pad('数量', 8) + 'source');
    for (const f of [...facts].sort((a, b) =>
      `${a.warehouseCode}:${a.bucket}`.localeCompare(`${b.warehouseCode}:${b.bucket}`),
    )) {
      console.log(
        pad(f.warehouseCode, 16) + pad(f.bucket, 22) + pad(String(f.qty), 8) + f.source,
      );
    }
  }
  console.log('');

  console.log('--- D. 物理仓对齐（可售↔overseas池↔影子on_hand；在途↔in_transit↔transfer_transit）---');
  console.log(
    pad('仓', 14) +
      pad('周转可售', 10) +
      pad('三池海外', 10) +
      pad('影子在库', 10) +
      pad('|', 3) +
      pad('周转在途', 10) +
      pad('三池在途', 10) +
      pad('影子在途', 10) +
      ' 备注',
  );

  const allocated = share.method === 'sales_share' ? allocateByShare(overseas.qtyAvailable, share) : null;

  for (const wh of [...physicalWarehouses].sort()) {
    const t = turnoverRow(turnoverMap, wh);
    const recAvail = t.qtyAvailable;
    const recTransit = t.qtyInTransit;
    const lotOverseas = lotQty(lots, wh, 'overseas');
    const lotTransit = lotQty(lots, wh, 'in_transit');
    const factOnHand = factQty(facts, wh, 'on_hand');
    const factTransit = factQty(facts, wh, 'transfer_transit');

    const notes: string[] = [];
    if (recAvail === 0 && lotOverseas > 0 && overseas.qtyAvailable > 0) {
      notes.push('三池有海外池但周转本仓可售为0(可能来自OVERSEAS拆批)');
    }
    if (allocated && overseas.qtyAvailable > 0) {
      const shareQty = allocated.get(wh) ?? 0;
      if (factOnHand > 0 && Math.abs(factOnHand - shareQty) > Math.max(3, Math.round(shareQty * 0.05))) {
        notes.push(`占比拟物${shareQty} vs 影子${factOnHand}`);
      }
    }
    if (recAvail !== lotOverseas && recAvail > 0 && lotOverseas > 0) {
      notes.push(`周转可售 vs 三池海外 ${fmtDiff(recAvail, lotOverseas)}`);
    }
    if (recTransit !== lotTransit && (recTransit > 0 || lotTransit > 0)) {
      notes.push(`周转在途 vs 三池在途 ${fmtDiff(recTransit, lotTransit)}`);
    }
    if (factOnHand > 0 && recAvail === 0 && lotOverseas === 0) {
      notes.push('影子有在库但周转/三池本仓为0');
    }

    console.log(
      pad(wh, 14) +
        pad(String(recAvail), 10) +
        pad(String(lotOverseas), 10) +
        pad(String(factOnHand), 10) +
        pad('|', 3) +
        pad(String(recTransit), 10) +
        pad(String(lotTransit), 10) +
        pad(String(factTransit), 10) +
        (notes.length ? ` ${notes.join('; ')}` : ''),
    );
  }
  console.log('');

  console.log('--- E. 逻辑仓 / 在产 ---');
  const lotLocalInProd = lotQty(lots, IN_PRODUCTION_WAREHOUSE, 'local');
  const lotOverseasPool = lots
    .filter((l) => l.warehouseCode === UNALLOCATED_TRANSIT_WAREHOUSE)
    .reduce((s, l) => s + l.qty, 0);
  console.log(
    `OVERSEAS 周转: 可售 ${overseas.qtyAvailable} 在途 ${overseas.qtyInTransit} | 三池该仓合计 ${lotOverseasPool}`,
  );
  console.log(
    `IN-PRODUCTION 周转在产 ${inProd.qtyInProduction} | 三池 local@${IN_PRODUCTION_WAREHOUSE} ${lotLocalInProd}`,
  );
  console.log('');

  console.log('--- F. 规划有效供给（snapshot_only，抽样物理仓）---');
  for (const wh of [...physicalWarehouses].sort().slice(0, 8)) {
    const pos = await resolveInventoryPosition({ skuId: sku.id, warehouseCode: wh });
    console.log(`${wh}: effectiveQty=${pos.effectiveQty} (可售${pos.qtyAvailable} 在途${pos.qtyInTransit})`);
  }
  if (physicalWarehouses.size > 8) {
    console.log(`… 共 ${physicalWarehouses.size} 个物理仓，仅展示前 8 个`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
