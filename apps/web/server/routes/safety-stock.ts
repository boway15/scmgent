import { eq, and, or, ilike, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, safetyStockConfig, skus } from '@scm/db';
import { parseListPagination } from '../lib/list-pagination.js';
import { parseProductScope, productScopeSql } from '../lib/planning-accessory-filter.js';
import { calcReorderPoint, calcReplenishment, type SalesDataPoint } from '../lib/replenishment.js';
import { requireMenu } from '../lib/rbac.js';
import { loadDailySalesForSku } from '../lib/sales-history-query.js';
import {
  resolveSuggestionInputs,
  resolveSuggestionInputsBatch,
  sortSuggestionRows,
  type SuggestionPairInput,
} from '../lib/safety-stock-suggestion-service.js';
import {
  calcSafetyStockQty,
  type SafetyStockMethod,
} from '../lib/safety-stock-z.js';

export const safetyStockRoutes = new Hono();

function resolveWarehouse(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query('warehouse')?.trim() || 'ALL';
}

type SafetyStockCalculationInput = {
  sales: SalesDataPoint[];
  leadTimeDays: number;
  unitCost: number;
  method: SafetyStockMethod;
  serviceLevel?: number | null;
  demandStdDev?: number | null;
  leadTimeStdDev?: number | null;
  safetyStockDays?: number | null;
};

export function calculateSafetyStockValues(params: SafetyStockCalculationInput) {
  const base = calcReplenishment({
    sales: params.sales,
    leadTimeDays: params.leadTimeDays,
    unitCost: params.unitCost,
  });
  const demandStdDev =
    params.method === 'coverage_days' ? 0 : (params.demandStdDev ?? base.stdDev);
  const safety = calcSafetyStockQty({
    method: params.method,
    serviceLevel: params.serviceLevel ?? undefined,
    demandStdDev,
    totalLeadDays: params.leadTimeDays,
    avgDaily: base.avgDaily,
    leadTimeStdDev: params.leadTimeStdDev ?? undefined,
    safetyStockDays: params.safetyStockDays ?? 14,
  });

  return {
    ...base,
    ...safety,
    reorderPoint: calcReorderPoint(base.avgDaily, params.leadTimeDays, safety.safetyStockQty),
    safetyStockMethod: params.method,
    serviceLevel: params.method === 'coverage_days' ? null : (params.serviceLevel ?? 0.95),
    demandStdDev: params.method === 'coverage_days' ? null : demandStdDev,
    leadTimeStdDev:
      params.method === 'z_demand_leadtime' ? (params.leadTimeStdDev ?? 0) : null,
  };
}

safetyStockRoutes.get('/safety-stock', async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const q = c.req.query('q')?.trim();
  const warehouse = c.req.query('warehouse')?.trim();

  const productScope = parseProductScope(c.req.query('productScope'));
  const conditions = [eq(skus.isActive, true), productScopeSql(productScope)];
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(or(ilike(skus.code, pattern), ilike(skus.name, pattern))!);
  }
  if (warehouse) {
    conditions.push(eq(safetyStockConfig.warehouseCode, warehouse));
  }

  const where = and(...conditions);
  const selectFields = {
    id: safetyStockConfig.id,
    skuId: skus.id,
    skuCode: skus.code,
    skuName: skus.name,
    warehouseCode: safetyStockConfig.warehouseCode,
    safetyStockQty: safetyStockConfig.safetyStockQty,
    reorderPoint: safetyStockConfig.reorderPoint,
    reorderQty: safetyStockConfig.reorderQty,
    safetyStockDays: safetyStockConfig.safetyStockDays,
    safetyStockMethod: safetyStockConfig.safetyStockMethod,
    serviceLevel: safetyStockConfig.serviceLevel,
    demandStdDev: safetyStockConfig.demandStdDev,
    leadTimeStdDev: safetyStockConfig.leadTimeStdDev,
    calcMethod: safetyStockConfig.calcMethod,
    lastCalcAt: safetyStockConfig.lastCalcAt,
  };

  const base = db
    .select(selectFields)
    .from(safetyStockConfig)
    .innerJoin(skus, eq(safetyStockConfig.skuId, skus.id))
    .where(where)
    .$dynamic();

  const [rows, countRow] = await Promise.all([
    base.orderBy(skus.code, safetyStockConfig.warehouseCode).limit(pageSize).offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(safetyStockConfig)
      .innerJoin(skus, eq(safetyStockConfig.skuId, skus.id))
      .where(where),
  ]);

  return c.json({
    items: rows,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
});

/** 与列表分页 pageSize 上限一致，避免当前页建议列缺行 */
const SUGGESTION_PAIRS_MAX = 100;

/** pairs=skuId:warehouse,skuId:warehouse — 仅计算请求方当前页，禁止全表扫描 */
function parseSuggestionPairs(raw: string | undefined): Array<{ skuId: string; warehouseCode: string }> {
  if (!raw?.trim()) return [];
  const seen = new Set<string>();
  const pairs: Array<{ skuId: string; warehouseCode: string }> = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const sep = trimmed.indexOf(':');
    if (sep <= 0 || sep === trimmed.length - 1) continue;
    const skuId = trimmed.slice(0, sep).trim();
    const warehouseCode = trimmed.slice(sep + 1).trim();
    if (!skuId || !warehouseCode) continue;
    const key = `${skuId}::${warehouseCode}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ skuId, warehouseCode });
    if (pairs.length >= SUGGESTION_PAIRS_MAX) break;
  }
  return pairs;
}

safetyStockRoutes.get('/safety-stock/suggestions', async (c) => {
  const serviceLevel = Number(c.req.query('serviceLevel') ?? 0.95);
  const sortParam = c.req.query('sort') ?? 'deltaDays_desc';
  const sort =
    sortParam === 'deltaDays_asc' || sortParam === 'skuCode'
      ? sortParam
      : 'deltaDays_desc';

  const pairs = parseSuggestionPairs(c.req.query('pairs') ?? undefined);
  if (!pairs.length) {
    return c.json({ items: [], total: 0 });
  }

  const skuIds = [...new Set(pairs.map((p) => p.skuId))];
  const rows = await db
    .select({
      skuId: skus.id,
      skuCode: skus.code,
      merchantCode: skus.merchantCode,
      leadTimeDays: skus.leadTimeDays,
      warehouseCode: safetyStockConfig.warehouseCode,
      safetyStockDays: safetyStockConfig.safetyStockDays,
      safetyStockQty: safetyStockConfig.safetyStockQty,
      reorderPoint: safetyStockConfig.reorderPoint,
      safetyStockMethod: safetyStockConfig.safetyStockMethod,
    })
    .from(safetyStockConfig)
    .innerJoin(skus, eq(safetyStockConfig.skuId, skus.id))
    .where(and(eq(skus.isActive, true), inArray(skus.id, skuIds)));

  const rowByKey = new Map(
    rows.map((row) => [`${row.skuId}::${row.warehouseCode}`, row] as const),
  );

  const batchInputs: SuggestionPairInput[] = [];
  for (const pair of pairs) {
    const row = rowByKey.get(`${pair.skuId}::${pair.warehouseCode}`);
    if (!row) continue;
    batchInputs.push({
      sku: {
        id: row.skuId,
        code: row.skuCode,
        merchantCode: row.merchantCode,
        leadTimeDays: row.leadTimeDays,
      },
      warehouseCode: row.warehouseCode,
      policy: row,
    });
  }

  const suggestions = await resolveSuggestionInputsBatch({
    pairs: batchInputs,
    serviceLevel: Number.isFinite(serviceLevel) ? serviceLevel : 0.95,
  });

  const sorted = sortSuggestionRows(suggestions, sort);
  return c.json({ items: sorted, total: sorted.length });
});

safetyStockRoutes.get('/safety-stock/:skuId/suggestion', async (c) => {
  const skuId = c.req.param('skuId')!;
  const warehouseCode = resolveWarehouse(c);
  const serviceLevel = Number(c.req.query('serviceLevel') ?? 0.95);

  const [sku] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
  if (!sku) return c.json({ message: 'SKU not found' }, 404);

  const [policy] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  const row = await resolveSuggestionInputs({
    sku: {
      id: sku.id,
      code: sku.code,
      merchantCode: sku.merchantCode,
      leadTimeDays: sku.leadTimeDays,
    },
    warehouseCode,
    serviceLevel: Number.isFinite(serviceLevel) ? serviceLevel : 0.95,
    policy: policy ?? null,
  });

  return c.json(row);
});

safetyStockRoutes.put('/safety-stock/:skuId', requireMenu('inventory.safety'), async (c) => {
  const skuId = c.req.param('skuId')!;
  const warehouseCode = resolveWarehouse(c);
  const body = await c.req.json<{
    safetyStockQty: number;
    reorderPoint: number;
    reorderQty: number;
    safetyStockDays?: number | null;
    safetyStockMethod?: SafetyStockMethod;
    serviceLevel?: number | null;
  }>();
  const method = body.safetyStockMethod ?? 'coverage_days';
  const values = {
    safetyStockQty: body.safetyStockQty,
    reorderPoint: body.reorderPoint,
    reorderQty: body.reorderQty,
    ...(body.safetyStockDays != null ? { safetyStockDays: body.safetyStockDays } : {}),
    safetyStockMethod: method,
    serviceLevel:
      method === 'coverage_days' || body.serviceLevel == null ? null : String(body.serviceLevel),
  };

  const [existing] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  if (existing) {
    const [row] = await db
      .update(safetyStockConfig)
      .set({
        ...values,
        calcMethod: 'manual',
        updatedAt: new Date(),
      })
      .where(eq(safetyStockConfig.id, existing.id))
      .returning();
    return c.json(row);
  }

  const [row] = await db
    .insert(safetyStockConfig)
    .values({
      skuId,
      warehouseCode,
      ...values,
      calcMethod: 'manual',
    })
    .returning();

  return c.json(row, 201);
});

safetyStockRoutes.post('/safety-stock/:skuId/calculate', requireMenu('inventory.safety'), async (c) => {
  const skuId = c.req.param('skuId')!;
  const warehouseCode = resolveWarehouse(c);
  const body: {
    safetyStockMethod?: SafetyStockMethod;
    serviceLevel?: number | null;
  } = await c.req.json().catch(() => ({}));

  const [sku] = await db.select().from(skus).where(eq(skus.id, skuId)).limit(1);
  if (!sku) return c.json({ message: 'SKU not found' }, 404);

  const sales = await loadDailySalesForSku(skuId);

  const [existing] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  const safetyStockMethod =
    body.safetyStockMethod ?? existing?.safetyStockMethod ?? 'coverage_days';
  const serviceLevel =
    body.serviceLevel ??
    (existing?.serviceLevel == null ? null : Number(existing.serviceLevel));
  const calc = calculateSafetyStockValues({
    sales: sales.map((s) => ({ qtySold: s.qtySold, saleDate: s.saleDate })),
    leadTimeDays: sku.leadTimeDays ?? 30,
    unitCost: sku.unitCost ? Number(sku.unitCost) : 1,
    method: safetyStockMethod,
    serviceLevel,
    demandStdDev:
      existing?.demandStdDev == null ? null : Number(existing.demandStdDev),
    leadTimeStdDev:
      existing?.leadTimeStdDev == null ? null : Number(existing.leadTimeStdDev),
    safetyStockDays: existing?.safetyStockDays,
  });

  const values = {
    safetyStockQty: calc.safetyStockQty,
    reorderPoint: calc.reorderPoint,
    reorderQty: calc.reorderQty,
    safetyStockMethod,
    serviceLevel: calc.serviceLevel == null ? null : String(calc.serviceLevel),
    demandStdDev: calc.demandStdDev == null ? null : String(calc.demandStdDev),
    leadTimeStdDev:
      calc.leadTimeStdDev == null ? null : String(calc.leadTimeStdDev),
    calcMethod: 'eoq' as const,
    lastCalcAt: new Date(),
    updatedAt: new Date(),
  };

  if (existing) {
    const [row] = await db
      .update(safetyStockConfig)
      .set(values)
      .where(eq(safetyStockConfig.id, existing.id))
      .returning();
    return c.json({ ...row, calc });
  }

  const [row] = await db
    .insert(safetyStockConfig)
    .values({ skuId, warehouseCode, ...values })
    .returning();

  return c.json({ ...row, calc });
});
