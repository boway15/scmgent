import { eq, and } from 'drizzle-orm';
import {
  db,
  skus,
  salesHistory,
  reorderSuggestions,
  safetyStockConfig,
  warehouses,
  spus,
} from '@scm/db';
import { applyMoq, calcReplenishment, resolveEffectiveMoq } from '../lib/replenishment.js';
import { formatCoverageReason, type InventoryHealth } from '../lib/replenishment-coverage.js';
import {
  getLatestInventorySnapshot,
  getRegionPoolSnapshot,
} from '../lib/inventory-snapshot.js';
import {
  shouldDeferReplenishment,
  splitQtyByDailyShare,
  US_WAREHOUSE_CODES,
} from '../lib/warehouse-domain.js';
import {
  normalizeReplenishLight,
  shouldReplenishByLight,
  type ReplenishLight,
} from '../lib/replenish-light.js';
import { enhanceReplenishmentReasons } from '../integrations/dify-workflows.js';
import { isReplenishmentWorkflowEnabled } from '../integrations/dify.js';
import {
  computeSkuWarehouseHealth,
  type SkuHealthRow,
} from '../lib/inventory-health-service.js';
import {
  saveHealthSnapshots,
  supersedePendingSuggestions,
} from '../lib/inventory-health-store.js';

async function upsertSafetyStock(
  skuId: string,
  warehouseCode: string,
  calc: ReturnType<typeof calcReplenishment>,
) {
  const [existing] = await db
    .select()
    .from(safetyStockConfig)
    .where(
      and(eq(safetyStockConfig.skuId, skuId), eq(safetyStockConfig.warehouseCode, warehouseCode)),
    )
    .limit(1);

  if (existing) {
    await db
      .update(safetyStockConfig)
      .set({
        safetyStockQty: calc.safetyStockQty,
        reorderPoint: calc.reorderPoint,
        reorderQty: calc.reorderQty,
        calcMethod: 'eoq',
        lastCalcAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(safetyStockConfig.id, existing.id));
  } else {
    await db.insert(safetyStockConfig).values({
      skuId,
      warehouseCode,
      safetyStockQty: calc.safetyStockQty,
      reorderPoint: calc.reorderPoint,
      reorderQty: calc.reorderQty,
      calcMethod: 'eoq',
      lastCalcAt: new Date(),
    });
  }
}

async function loadPolicyMap(skuId: string) {
  const rows = await db
    .select()
    .from(safetyStockConfig)
    .where(eq(safetyStockConfig.skuId, skuId));
  return new Map(rows.map((row) => [row.warehouseCode, row]));
}

export async function runReplenishmentForecast() {
  const spuMoqMap = new Map(
    (await db.select({ id: spus.id, moq: spus.moq }).from(spus)).map((s) => [s.id, s.moq]),
  );

  const activeSkus = await db
    .select({
      id: skus.id,
      code: skus.code,
      spuId: skus.spuId,
      moq: skus.moq,
      merchantCode: skus.merchantCode,
      replenishLight: skus.replenishLight,
      leadTimeDays: skus.leadTimeDays,
      unitCost: skus.unitCost,
    })
    .from(skus)
    .where(eq(skus.isActive, true));

  const whRows = await db
    .select({
      code: warehouses.code,
      regionGroup: warehouses.regionGroup,
      countryCode: warehouses.countryCode,
    })
    .from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(warehouses.sortOrder);

  if (!activeSkus.length || !whRows.length) {
    return { suggestionCount: 0, snapshotCount: 0, message: 'No active SKUs or warehouses' };
  }

  let count = 0;
  const healthRows: SkuHealthRow[] = [];
  const results: Array<{
    skuCode: string;
    warehouseCode: string;
    suggestedQty: number;
    healthStatus: InventoryHealth;
    reason: string;
  }> = [];
  const pending: Array<{
    skuId: string;
    skuCode: string;
    spuId: string | null;
    replenishLight: ReplenishLight;
    warehouseCode: string;
    suggestedQty: number;
    suggestedDate: string;
    reason: string;
    healthStatus: InventoryHealth;
    coverageDays: number;
    totalLeadDays: number;
    latestOrderDays: number;
    metrics: Record<string, unknown>;
  }> = [];

  for (const sku of activeSkus) {
    const replenishLight = normalizeReplenishLight(sku.replenishLight);
    const effectiveMoq = resolveEffectiveMoq(
      sku.moq,
      sku.spuId ? spuMoqMap.get(sku.spuId) : null,
    );
    const policyMap = await loadPolicyMap(sku.id);
    const forecastByStation = new Map<
      string,
      { map: Map<string, number>; lifecycle?: string }
    >();

    const salesRows = await db
      .select({
        qtySold: salesHistory.qtySold,
        saleDate: salesHistory.saleDate,
        warehouseCode: salesHistory.warehouseCode,
      })
      .from(salesHistory)
      .where(eq(salesHistory.skuId, sku.id));

    const dailyByWh: Record<string, number> = {};
    const coverageByWh: Record<string, SkuHealthRow['coverage']> = {};
    const networkRopByRegion: Record<string, number> = {};

    for (const wh of whRows) {
      const health = await computeSkuWarehouseHealth({
        sku,
        warehouse: wh,
        salesRows,
        policyMap,
        forecastByStation,
        moq: effectiveMoq || undefined,
      });
      healthRows.push(health);
      dailyByWh[wh.code] = health.avgDaily;
      coverageByWh[wh.code] = health.coverage;

      const eoqCalc = calcReplenishment({
        sales: salesRows
          .filter((s) => s.warehouseCode === wh.code)
          .map((s) => ({ qtySold: s.qtySold, saleDate: String(s.saleDate) })),
        leadTimeDays: health.totalLeadDays,
        unitCost: sku.unitCost ? Number(sku.unitCost) : 1,
      });
      await upsertSafetyStock(sku.id, wh.code, eoqCalc);
      networkRopByRegion[wh.regionGroup] =
        (networkRopByRegion[wh.regionGroup] ?? 0) + eoqCalc.reorderPoint;
    }

    const usPool = await getRegionPoolSnapshot(sku.id, 'US');
    const usNetworkRop = networkRopByRegion.US ?? 0;
    const usNetworkDaily = US_WAREHOUSE_CODES.reduce(
      (sum, code) => sum + (dailyByWh[code] ?? 0),
      0,
    );
    const usNetworkCoverage =
      usNetworkDaily > 0 ? usPool.effectiveQty / usNetworkDaily : Number.POSITIVE_INFINITY;

    for (const wh of whRows) {
      const health = healthRows.find(
        (h) => h.skuId === sku.id && h.warehouseCode === wh.code,
      )!;
      const coverage = coverageByWh[wh.code];
      if (!coverage.needsReplenishment) continue;

      const snapshot = await getLatestInventorySnapshot(sku.id, wh.code);
      const eoqRop = (health.metrics.reorderPoint as number) ?? 0;

      if (wh.regionGroup === 'US') {
        const defer = shouldDeferReplenishment({
          warehouseEffective: snapshot.effectiveQty,
          warehouseRop: eoqRop,
          networkEffective: usPool.effectiveQty,
          networkRop: usNetworkRop,
        });
        if (defer && usNetworkCoverage >= coverage.targetCoverageDays) continue;
      }

      let suggestedQty = coverage.suggestedQty;
      if (wh.regionGroup === 'US' && usPool.effectiveQty < usNetworkRop) {
        const networkQty = coverage.suggestedQty;
        const split = splitQtyByDailyShare(networkQty, dailyByWh);
        suggestedQty = split[wh.code] ?? coverage.suggestedQty;
      }

      if (suggestedQty <= 0) continue;

      const rawQty = suggestedQty;
      suggestedQty = applyMoq(suggestedQty, effectiveMoq);

      const poolNote =
        wh.regionGroup === 'US'
          ? `US仓网覆盖 ${Number.isFinite(usNetworkCoverage) ? usNetworkCoverage.toFixed(1) : '∞'} 天`
          : undefined;
      const moqNote =
        effectiveMoq > 0 && suggestedQty > rawQty ? `MOQ ${effectiveMoq}` : undefined;
      const reasonBase = formatCoverageReason({
        warehouseCode: wh.code,
        effectiveQty: snapshot.effectiveQty,
        avgDaily: dailyByWh[wh.code] ?? 0,
        result: coverage,
        poolNote,
        moqNote,
      });
      const reason =
        health.demandSource === 'forecast'
          ? `${reasonBase}，需求口径：月度预测日均`
          : reasonBase;

      pending.push({
        skuId: sku.id,
        skuCode: sku.code,
        spuId: sku.spuId,
        replenishLight,
        warehouseCode: wh.code,
        suggestedQty,
        suggestedDate: coverage.suggestedDate,
        reason,
        healthStatus: coverage.healthStatus,
        coverageDays: coverage.coverageDays,
        totalLeadDays: coverage.leadTime.totalLeadDays,
        latestOrderDays: coverage.latestOrderDays,
        metrics: health.metrics,
      });
    }
  }

  const snapshotCount = await saveHealthSnapshots(healthRows);

  const spuRedNeeding = new Set<string>();
  for (const item of pending) {
    if (item.replenishLight === 'red' && item.spuId) {
      spuRedNeeding.add(item.spuId);
    }
  }

  const eligibleItems = pending.filter((item) =>
    shouldReplenishByLight({
      replenishLight: item.replenishLight,
      needsReplenishment: true,
      spuHasRedNeedingReplenishment: item.spuId ? spuRedNeeding.has(item.spuId) : false,
    }),
  );

  let enhancedReasons = new Map<string, string>();
  let difyEnhanced = false;

  if (isReplenishmentWorkflowEnabled() && eligibleItems.length) {
    try {
      enhancedReasons = await enhanceReplenishmentReasons(
        eligibleItems.map((item) => ({
          skuCode: item.skuCode,
          warehouseCode: item.warehouseCode,
          suggestedQty: item.suggestedQty,
          reason: item.reason,
        })),
      );
      difyEnhanced = enhancedReasons.size > 0;
    } catch (err) {
      console.warn('[replenishmentForecast] Dify workflow skipped:', err);
    }
  }

  for (const item of eligibleItems) {
    await supersedePendingSuggestions(item.skuId, item.warehouseCode);

    const reasonKey = `${item.skuCode}::${item.warehouseCode}`;
    const reason = enhancedReasons.get(reasonKey) ?? item.reason;

    await db.insert(reorderSuggestions).values({
      skuId: item.skuId,
      warehouseCode: item.warehouseCode,
      suggestedQty: item.suggestedQty,
      suggestedDate: item.suggestedDate,
      reason,
      healthStatus: item.healthStatus,
      coverageDays: Number.isFinite(item.coverageDays) ? String(item.coverageDays) : null,
      totalLeadDays: item.totalLeadDays,
      latestOrderDays: Number.isFinite(item.latestOrderDays)
        ? String(item.latestOrderDays)
        : null,
      metrics: item.metrics,
      status: 'pending',
    });

    results.push({
      skuCode: item.skuCode,
      warehouseCode: item.warehouseCode,
      suggestedQty: item.suggestedQty,
      healthStatus: item.healthStatus,
      reason,
    });
    count++;
  }

  const engine = difyEnhanced
    ? 'coverage-lead-time+dify-enhanced'
    : 'coverage-lead-time';

  return { suggestionCount: count, snapshotCount, engine, difyEnhanced, results };
}
