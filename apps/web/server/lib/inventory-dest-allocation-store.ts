import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  db,
  inventoryDestAllocations,
  inventorySupplyLots,
  skus,
} from '@scm/db';
import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants.js';
import {
  applyDestAssignments,
  isUnallocatedLot,
  suggestDestAssignments,
  type ConfirmedDestAllocation,
  type DestAssignment,
  UNALLOCATED_WAREHOUSE,
} from './inventory-dest-allocation.js';
import { parseSharesFromSnapshot } from './inventory-share-allocation.js';
import { readTurnoverSnapshot } from './inventory-turnover-snapshot.js';
import type { BuiltSupplyLot } from './inventory-supply-lots.js';
import { productScopeSql, type ProductScope } from './planning-accessory-filter.js';

function asIsoDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function toBuiltLot(row: {
  skuId: string;
  warehouseCode: string;
  pool: BuiltSupplyLot['pool'];
  qty: number;
  factoryCode: string | null;
  productionStatus: BuiltSupplyLot['productionStatus'] | null;
  shipReadyAt: string | Date | null;
  latestShipDate?: string | Date | null;
  availableAt: string | Date | null;
  source: BuiltSupplyLot['source'];
  sourceId: string | null;
  status: BuiltSupplyLot['status'];
  etaEstimated?: boolean;
  dateUnknown?: boolean;
}): BuiltSupplyLot {
  return {
    skuId: row.skuId,
    warehouseCode: row.warehouseCode,
    pool: row.pool,
    qty: row.qty,
    factoryCode: row.factoryCode,
    productionStatus: row.productionStatus,
    shipReadyAt: asIsoDate(row.shipReadyAt),
    latestShipDate: asIsoDate(row.latestShipDate ?? null),
    availableAt: asIsoDate(row.availableAt),
    source: row.source,
    sourceId: row.sourceId,
    status: row.status,
    etaEstimated: row.etaEstimated,
    dateUnknown: row.dateUnknown ?? asIsoDate(row.availableAt) == null,
  };
}

export async function loadConfirmedDestAllocations(): Promise<ConfirmedDestAllocation[]> {
  const rows = await db
    .select({
      source: inventoryDestAllocations.source,
      sourceId: inventoryDestAllocations.sourceId,
      pool: inventoryDestAllocations.pool,
      warehouseCode: inventoryDestAllocations.warehouseCode,
      qty: inventoryDestAllocations.qty,
    })
    .from(inventoryDestAllocations);
  return rows;
}

function buildUnallocatedConditions(params?: {
  skuId?: string;
  pool?: 'overseas' | 'in_transit' | 'local';
  q?: string;
  productScope?: ProductScope;
}) {
  const conditions = [
    eq(inventorySupplyLots.status, 'open'),
    eq(inventorySupplyLots.warehouseCode, UNALLOCATED_WAREHOUSE),
    productScopeSql(params?.productScope ?? 'goods'),
  ];
  if (params?.pool) conditions.push(eq(inventorySupplyLots.pool, params.pool));
  if (params?.skuId) conditions.push(eq(inventorySupplyLots.skuId, params.skuId));
  const q = params?.q?.trim();
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(skus.code, pattern),
        ilike(skus.name, pattern),
        ilike(inventorySupplyLots.factoryCode, pattern),
      )!,
    );
  }
  return and(...conditions);
}

export async function listUnallocatedSupply(params?: {
  skuId?: string;
  pool?: 'overseas' | 'in_transit' | 'local';
  limit?: number;
  offset?: number;
  q?: string;
  productScope?: ProductScope;
}) {
  const limit = params?.limit ?? 500;
  const offset = params?.offset ?? 0;
  const where = buildUnallocatedConditions(params);

  const items = await db
    .select({
      id: inventorySupplyLots.id,
      skuId: inventorySupplyLots.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      warehouseCode: inventorySupplyLots.warehouseCode,
      pool: inventorySupplyLots.pool,
      qty: inventorySupplyLots.qty,
      factoryCode: inventorySupplyLots.factoryCode,
      productionStatus: inventorySupplyLots.productionStatus,
      shipReadyAt: inventorySupplyLots.shipReadyAt,
      latestShipDate: inventorySupplyLots.latestShipDate,
      availableAt: inventorySupplyLots.availableAt,
      source: inventorySupplyLots.source,
      sourceId: inventorySupplyLots.sourceId,
      status: inventorySupplyLots.status,
      etaEstimated: inventorySupplyLots.etaEstimated,
      dateUnknown: inventorySupplyLots.dateUnknown,
      updatedAt: inventorySupplyLots.updatedAt,
    })
    .from(inventorySupplyLots)
    .innerJoin(skus, eq(inventorySupplyLots.skuId, skus.id))
    .where(where)
    .orderBy(desc(inventorySupplyLots.updatedAt))
    .limit(limit)
    .offset(offset);

  const skuIds = [...new Set(items.map((row) => row.skuId))];
  const skuRows =
    skuIds.length === 0
      ? []
      : await db
          .select({ id: skus.id, encodingMeta: skus.encodingMeta })
          .from(skus)
          .where(inArray(skus.id, skuIds));
  const shareBySku = new Map(
    skuRows.map((row) => [row.id, parseSharesFromSnapshot(readTurnoverSnapshot(row.encodingMeta))]),
  );

  return items.map((row) => {
    const share = shareBySku.get(row.skuId) ?? parseSharesFromSnapshot({});
    return {
      ...row,
      suggestedDestinations: suggestDestAssignments(row.qty, share),
    };
  });
}

export async function assignUnallocatedLot(params: {
  lotId: string;
  assignments: DestAssignment[];
  userId?: string | null;
}) {
  const [existing] = await db
    .select()
    .from(inventorySupplyLots)
    .where(eq(inventorySupplyLots.id, params.lotId))
    .limit(1);
  if (!existing) return null;
  if (!existing.sourceId) {
    throw new Error('批次缺少来源编号，无法确认落仓');
  }
  if (!isUnallocatedLot(existing)) {
    throw new Error('只有未定仓批次可以确认落仓');
  }

  const destLots = applyDestAssignments(toBuiltLot(existing), params.assignments);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .delete(inventoryDestAllocations)
      .where(
        and(
          eq(inventoryDestAllocations.source, existing.source),
          eq(inventoryDestAllocations.sourceId, existing.sourceId),
          eq(inventoryDestAllocations.pool, existing.pool),
        ),
      );

    if (destLots.length) {
      await tx.insert(inventoryDestAllocations).values(
        destLots.map((row) => ({
          skuId: existing.skuId,
          source: existing.source,
          sourceId: existing.sourceId as string,
          pool: existing.pool,
          warehouseCode: row.warehouseCode,
          qty: row.qty,
          confirmedBy: params.userId ?? null,
          confirmedAt: now,
          updatedAt: now,
        })),
      );
    }

    for (const row of destLots) {
      await tx
        .insert(inventorySupplyLots)
        .values({
          skuId: existing.skuId,
          warehouseCode: row.warehouseCode,
          pool: existing.pool,
          qty: row.qty,
          factoryCode: existing.factoryCode,
          productionStatus: existing.productionStatus,
          shipReadyAt: existing.shipReadyAt,
          latestShipDate: existing.latestShipDate,
          availableAt: existing.availableAt,
          source: existing.source,
          sourceId: existing.sourceId,
          status: 'open',
          etaEstimated: existing.etaEstimated,
          dateUnknown: existing.dateUnknown,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            inventorySupplyLots.source,
            inventorySupplyLots.sourceId,
            inventorySupplyLots.pool,
            inventorySupplyLots.warehouseCode,
          ],
          set: {
            qty: sql`excluded.qty`,
            factoryCode: sql`excluded.factory_code`,
            productionStatus: sql`excluded.production_status`,
            shipReadyAt: sql`excluded.ship_ready_at`,
            latestShipDate: sql`excluded.latest_ship_date`,
            availableAt: sql`excluded.available_at`,
            status: sql`'open'`,
            etaEstimated: sql`excluded.eta_estimated`,
            dateUnknown: sql`excluded.date_unknown`,
            updatedAt: now,
          },
        });
    }

    await tx
      .update(inventorySupplyLots)
      .set({ status: 'cancelled', updatedAt: now })
      .where(eq(inventorySupplyLots.id, existing.id));
  });

  return { items: destLots };
}

export async function countOpenUnallocatedLots(params?: {
  skuId?: string;
  pool?: 'overseas' | 'in_transit' | 'local';
  q?: string;
  productScope?: ProductScope;
}): Promise<number> {
  const where = buildUnallocatedConditions(params);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inventorySupplyLots)
    .innerJoin(skus, eq(inventorySupplyLots.skuId, skus.id))
    .where(where);
  return Number(row?.count ?? 0);
}

export async function sumOpenUnallocatedQtyFiltered(params?: {
  skuId?: string;
  pool?: 'overseas' | 'in_transit' | 'local';
  q?: string;
  productScope?: ProductScope;
}): Promise<number> {
  const where = buildUnallocatedConditions(params);
  const [row] = await db
    .select({ qty: sql<number>`coalesce(sum(${inventorySupplyLots.qty}), 0)::int` })
    .from(inventorySupplyLots)
    .innerJoin(skus, eq(inventorySupplyLots.skuId, skus.id))
    .where(where);
  return Number(row?.qty ?? 0);
}

export async function sumOpenUnallocatedQty(skuId: string): Promise<number> {
  const [row] = await db
    .select({ qty: sql<number>`coalesce(sum(${inventorySupplyLots.qty}), 0)::int` })
    .from(inventorySupplyLots)
    .where(
      and(
        eq(inventorySupplyLots.skuId, skuId),
        eq(inventorySupplyLots.status, 'open'),
        inArray(inventorySupplyLots.warehouseCode, [
          UNALLOCATED_WAREHOUSE,
          IN_PRODUCTION_WAREHOUSE,
        ]),
      ),
    );
  return Number(row?.qty ?? 0);
}
