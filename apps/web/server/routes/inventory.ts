import { eq, desc, and, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, inventoryRecords, skus, safetyStockConfig, warehouses, channelWarehousePrefs, merchants, salesForecastMonthly } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import { buildCsv, csvAttachment } from '../lib/csv-export.js';
import { IN_PRODUCTION_WAREHOUSE } from '../lib/inventory-constants.js';
import { getLatestInProductionQty } from '../lib/inventory-snapshot.js';
import {
  applyReplenishLightToRows,
  normalizeReplenishLight,
  needsReplenishmentByInventory,
  type ReplenishLight,
} from '../lib/replenish-light.js';
import type { InventoryHealth } from '../lib/inventory-light.js';
import { getLatestHealthSnapshots } from '../lib/inventory-health-store.js';
import { writeAuditLog } from '../lib/audit-log.js';

export const inventoryRoutes = new Hono();

inventoryRoutes.get('/inventory/overview', requireMenu('inventory.overview'), async (c) => {
  const warehouseFilter = c.req.query('warehouse');

  const healthSnapshots = await getLatestHealthSnapshots({
    warehouseCode: warehouseFilter ?? undefined,
    limit: 5000,
  });
  const healthByKey = new Map(
    healthSnapshots.map((h) => [`${h.skuId}::${h.warehouseCode}`, h]),
  );

  const whList = warehouseFilter
    ? [{ code: warehouseFilter }]
    : await db
        .select({ code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.isActive, true))
        .orderBy(warehouses.sortOrder);

  const skuRows = await db
    .select({
      id: skus.id,
      code: skus.code,
      name: skus.name,
      unit: skus.unit,
      spuId: skus.spuId,
      replenishLight: skus.replenishLight,
    })
    .from(skus)
    .where(eq(skus.isActive, true))
    .orderBy(skus.code);

  const skuIds = skuRows.map((s) => s.id);
  const lifecycleBySku = new Map<string, string>();
  if (skuIds.length) {
    const lifecycleRows = await db
      .select({
        skuId: salesForecastMonthly.skuId,
        lifecycle: salesForecastMonthly.lifecycle,
      })
      .from(salesForecastMonthly)
      .where(inArray(salesForecastMonthly.skuId, skuIds));
    for (const row of lifecycleRows) {
      if (row.lifecycle && !lifecycleBySku.has(row.skuId)) {
        lifecycleBySku.set(row.skuId, row.lifecycle);
      }
    }
  }

  const draftRows: Array<{
    skuId: string;
    code: string;
    name: string;
    unit: string;
    spuId: string | null;
    replenishLight: ReplenishLight;
    warehouseCode: string;
    qtyAvailable: number;
    qtyInTransit: number;
    qtyInProduction: number;
    qtyReserved: number;
    localEffectiveQty: number;
    safetyStockQty: number | null;
    reorderPoint: number | null;
    status: 'normal' | 'alert' | 'danger' | 'stockout';
    needsReplenishment: boolean;
    inventoryHealth: InventoryHealth;
  }> = [];

  for (const sku of skuRows) {
    const qtyInProduction = await getLatestInProductionQty(sku.id);

    for (const wh of whList) {
      const [record] = await db
        .select({
          qtyAvailable: inventoryRecords.qtyAvailable,
          qtyInTransit: inventoryRecords.qtyInTransit,
          qtyReserved: inventoryRecords.qtyReserved,
        })
        .from(inventoryRecords)
        .where(and(eq(inventoryRecords.skuId, sku.id), eq(inventoryRecords.warehouse, wh.code)))
        .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
        .limit(1);

      const [cfg] = await db
        .select({
          safetyStockQty: safetyStockConfig.safetyStockQty,
          reorderPoint: safetyStockConfig.reorderPoint,
        })
        .from(safetyStockConfig)
        .where(
          and(eq(safetyStockConfig.skuId, sku.id), eq(safetyStockConfig.warehouseCode, wh.code)),
        )
        .limit(1);

      const qtyAvailable = record?.qtyAvailable ?? 0;
      const qtyInTransit = record?.qtyInTransit ?? 0;
      const qtyReserved = record?.qtyReserved ?? 0;
      const localEffectiveQty = qtyAvailable + qtyInTransit;

      let status: 'normal' | 'alert' | 'danger' | 'stockout' = 'normal';
      if (localEffectiveQty <= 0) status = 'stockout';
      else if (cfg?.safetyStockQty != null && localEffectiveQty < cfg.safetyStockQty) status = 'danger';
      else if (cfg?.reorderPoint != null && localEffectiveQty < cfg.reorderPoint) status = 'alert';

      const healthSnap = healthByKey.get(`${sku.id}::${wh.code}`);
      const inventoryHealth: InventoryHealth =
        (healthSnap?.healthStatus as InventoryHealth) ??
        (localEffectiveQty <= 0 ? 'red' : 'green');

      draftRows.push({
        skuId: sku.id,
        code: sku.code,
        name: sku.name,
        unit: sku.unit,
        spuId: sku.spuId,
        replenishLight: normalizeReplenishLight(sku.replenishLight),
        warehouseCode: wh.code,
        qtyAvailable,
        qtyInTransit,
        qtyInProduction,
        qtyReserved,
        localEffectiveQty,
        safetyStockQty: cfg?.safetyStockQty ?? null,
        reorderPoint: cfg?.reorderPoint ?? null,
        status,
        needsReplenishment: needsReplenishmentByInventory(localEffectiveQty, cfg?.reorderPoint),
        inventoryHealth,
      });
    }
  }

  const enriched = applyReplenishLightToRows(draftRows).map((row) => {
    const snapshot = healthByKey.get(`${row.skuId}::${row.warehouseCode}`);
    return {
    skuId: row.skuId,
    code: row.code,
    name: row.name,
    unit: row.unit,
    spuId: row.spuId,
    replenishLight: row.replenishLight,
    warehouseCode: row.warehouseCode,
    qtyAvailable: row.qtyAvailable,
    qtyInTransit: row.qtyInTransit,
    qtyInProduction: row.qtyInProduction,
    qtyReserved: row.qtyReserved,
    localEffectiveQty: row.localEffectiveQty,
    effectiveQty: row.localEffectiveQty,
    currentQty: row.localEffectiveQty,
    safetyStockQty: row.safetyStockQty,
    reorderPoint: row.reorderPoint,
    status: row.status,
    needsReplenishment: row.needsReplenishment,
    replenishEligible: row.replenishEligible,
    inventoryHealth: row.inventoryHealth,
    coverageDays: snapshot?.coverageDays != null ? Number(snapshot.coverageDays) : null,
    demandSource: snapshot?.demandSource ?? null,
  };
  });

  return c.json(enriched);
});

inventoryRoutes.get('/inventory/export', async (c) => {
  const warehouseFilter = c.req.query('warehouse');
  const whList = warehouseFilter
    ? [{ code: warehouseFilter }]
    : await db
        .select({ code: warehouses.code })
        .from(warehouses)
        .where(eq(warehouses.isActive, true))
        .orderBy(warehouses.sortOrder);

  const skuRows = await db
    .select({ id: skus.id, code: skus.code, name: skus.name, replenishLight: skus.replenishLight })
    .from(skus)
    .where(eq(skus.isActive, true))
    .orderBy(skus.code);

  const rows: Array<Array<string | number>> = [];
  for (const sku of skuRows) {
    const qtyInProduction = await getLatestInProductionQty(sku.id);

    for (const wh of whList) {
      const [record] = await db
        .select({
          qtyAvailable: inventoryRecords.qtyAvailable,
          qtyInTransit: inventoryRecords.qtyInTransit,
          qtyReserved: inventoryRecords.qtyReserved,
        })
        .from(inventoryRecords)
        .where(and(eq(inventoryRecords.skuId, sku.id), eq(inventoryRecords.warehouse, wh.code)))
        .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
        .limit(1);

      const [cfg] = await db
        .select({ reorderPoint: safetyStockConfig.reorderPoint })
        .from(safetyStockConfig)
        .where(
          and(eq(safetyStockConfig.skuId, sku.id), eq(safetyStockConfig.warehouseCode, wh.code)),
        )
        .limit(1);

      const qtyAvailable = record?.qtyAvailable ?? 0;
      const qtyInTransit = record?.qtyInTransit ?? 0;
      const qtyReserved = record?.qtyReserved ?? 0;
      const localEffectiveQty = qtyAvailable + qtyInTransit;

      rows.push([
        wh.code,
        sku.code,
        sku.name,
        normalizeReplenishLight(sku.replenishLight),
        qtyAvailable,
        qtyInTransit,
        qtyInProduction,
        qtyReserved,
        localEffectiveQty,
        cfg?.reorderPoint ?? '',
      ]);
    }
  }

  const csv = buildCsv(
    ['warehouse', 'sku_code', 'sku_name', 'replenish_light', 'qty_available', 'qty_in_transit', 'sku_qty_in_production', 'qty_reserved', 'local_effective_qty', 'reorder_point'],
    rows,
  );
  return csvAttachment(`inventory-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

inventoryRoutes.get('/inventory/records', async (c) => {
  const skuId = c.req.query('skuId');

  const baseQuery = db
    .select({
      id: inventoryRecords.id,
      skuId: inventoryRecords.skuId,
      skuCode: skus.code,
      warehouse: inventoryRecords.warehouse,
      qtyAvailable: inventoryRecords.qtyAvailable,
      qtyInTransit: inventoryRecords.qtyInTransit,
      qtyInProduction: inventoryRecords.qtyInProduction,
      recordedDate: inventoryRecords.recordedDate,
      source: inventoryRecords.source,
    })
    .from(inventoryRecords)
    .innerJoin(skus, eq(skus.id, inventoryRecords.skuId))
    .$dynamic();

  const rows = skuId
    ? await baseQuery
        .where(eq(inventoryRecords.skuId, skuId))
        .orderBy(desc(inventoryRecords.recordedDate))
        .limit(100)
    : await baseQuery.orderBy(desc(inventoryRecords.recordedDate)).limit(100);

  return c.json(rows);
});

inventoryRoutes.post('/inventory/records', requireMenu('inventory.overview'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    skuId: string;
    warehouse: string;
    qtyAvailable?: number;
    qtyInTransit?: number;
    qtyInProduction?: number;
    recordedDate: string;
  }>();

  if (!body.skuId || !body.warehouse || !body.recordedDate) {
    return c.json({ message: 'skuId, warehouse, recordedDate required' }, 400);
  }

  const isProductionPool = body.warehouse === IN_PRODUCTION_WAREHOUSE;
  if (isProductionPool) {
    if (body.qtyInProduction == null) {
      return c.json({ message: 'qtyInProduction required for IN-PRODUCTION pool' }, 400);
    }
  } else if (body.qtyAvailable == null) {
    return c.json({ message: 'qtyAvailable required for physical warehouse' }, 400);
  }

  const [row] = await db
    .insert(inventoryRecords)
    .values({
      skuId: body.skuId,
      warehouse: body.warehouse,
      qtyAvailable: isProductionPool ? 0 : (body.qtyAvailable ?? 0),
      qtyInTransit: isProductionPool ? 0 : (body.qtyInTransit ?? 0),
      qtyInProduction: isProductionPool ? body.qtyInProduction! : 0,
      recordedDate: body.recordedDate,
      source: 'manual',
      createdBy: user.id,
    })
    .returning();

  await writeAuditLog(c, {
    action: 'inventory_record.create',
    resourceType: 'inventory_record',
    resourceId: row.id,
    detail: body,
    user,
  });

  return c.json(row, 201);
});

inventoryRoutes.get('/merchants', async (c) => {
  const masterRows = await db
    .select({
      merchantCode: merchants.code,
      merchantName: merchants.name,
    })
    .from(merchants)
    .where(eq(merchants.isActive, true))
    .orderBy(merchants.code);

  if (masterRows.length) {
    return c.json(masterRows);
  }

  const rows = await db
    .select({
      merchantCode: skus.merchantCode,
      merchantName: skus.merchantName,
    })
    .from(skus)
    .where(eq(skus.isActive, true));

  const map = new Map<string, string | null>();
  for (const row of rows) {
    if (!row.merchantCode) continue;
    if (!map.has(row.merchantCode)) {
      map.set(row.merchantCode, row.merchantName);
    }
  }

  return c.json(
    Array.from(map.entries())
      .map(([merchantCode, merchantName]) => ({ merchantCode, merchantName }))
      .sort((a, b) => a.merchantCode.localeCompare(b.merchantCode)),
  );
});

inventoryRoutes.get('/warehouses', async (c) => {
  const rows = await db
    .select()
    .from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(warehouses.sortOrder);
  return c.json(rows);
});

inventoryRoutes.get('/channel-warehouse-prefs', async (c) => {
  const rows = await db
    .select()
    .from(channelWarehousePrefs)
    .where(eq(channelWarehousePrefs.isActive, true))
    .orderBy(channelWarehousePrefs.channel);
  return c.json(rows);
});
