import { eq, and } from 'drizzle-orm';
import { db, skus, salesHistory, reorderSuggestions, safetyStockConfig, warehouses, spus } from '../_db';
import { applyMoq, calcReplenishment, resolveEffectiveMoq } from '../lib/replenishment';
import {
  getLatestInventorySnapshot,
  getRegionPoolSnapshot,
} from '../lib/inventory-snapshot';
import {
  shouldDeferReplenishment,
  splitQtyByDailyShare,
  US_WAREHOUSE_CODES,
} from '../lib/warehouse-domain';
import {
  normalizeReplenishLight,
  shouldReplenishByLight,
  type ReplenishLight,
} from '../lib/replenish-light';

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

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
      replenishLight: skus.replenishLight,
      leadTimeDays: skus.leadTimeDays,
      unitCost: skus.unitCost,
    })
    .from(skus)
    .where(eq(skus.isActive, true));

  const whRows = await db
    .select({ code: warehouses.code, regionGroup: warehouses.regionGroup })
    .from(warehouses)
    .where(eq(warehouses.isActive, true))
    .orderBy(warehouses.sortOrder);

  if (!activeSkus.length || !whRows.length) {
    return { suggestionCount: 0, message: 'No active SKUs or warehouses' };
  }

  let count = 0;
  const results: Array<{ skuCode: string; warehouseCode: string; suggestedQty: number; reason: string }> =
    [];
  const pending: Array<{
    skuId: string;
    skuCode: string;
    spuId: string | null;
    replenishLight: ReplenishLight;
    warehouseCode: string;
    suggestedQty: number;
    suggestedDate: string;
    reason: string;
  }> = [];

  for (const sku of activeSkus) {
    const leadTime = sku.leadTimeDays ?? 30;
    const replenishLight = normalizeReplenishLight(sku.replenishLight);
    const effectiveMoq = resolveEffectiveMoq(
      sku.moq,
      sku.spuId ? spuMoqMap.get(sku.spuId) : null,
    );

    const salesRows = await db
      .select({
        qtySold: salesHistory.qtySold,
        saleDate: salesHistory.saleDate,
        warehouseCode: salesHistory.warehouseCode,
      })
      .from(salesHistory)
      .where(eq(salesHistory.skuId, sku.id));

    const calcsByWh: Record<string, ReturnType<typeof calcReplenishment>> = {};
    const dailyByWh: Record<string, number> = {};
    const networkRopByRegion: Record<string, number> = {};

    for (const wh of whRows) {
      const whSales = salesRows
        .filter((s) => s.warehouseCode === wh.code)
        .map((s) => ({ qtySold: s.qtySold, saleDate: String(s.saleDate) }));

      const calc = calcReplenishment({
        sales: whSales,
        leadTimeDays: leadTime,
        unitCost: sku.unitCost ? Number(sku.unitCost) : 1,
      });
      calcsByWh[wh.code] = calc;
      dailyByWh[wh.code] = calc.avgDaily;
      await upsertSafetyStock(sku.id, wh.code, calc);
      networkRopByRegion[wh.regionGroup] =
        (networkRopByRegion[wh.regionGroup] ?? 0) + calc.reorderPoint;
    }

    const usPool = await getRegionPoolSnapshot(sku.id, 'US');
    const usNetworkRop = networkRopByRegion.US ?? 0;

    for (const wh of whRows) {
      const calc = calcsByWh[wh.code];
      const snapshot = await getLatestInventorySnapshot(sku.id, wh.code);

      if (wh.regionGroup === 'US') {
        const defer = shouldDeferReplenishment({
          warehouseEffective: snapshot.effectiveQty,
          warehouseRop: calc.reorderPoint,
          networkEffective: usPool.effectiveQty,
          networkRop: usNetworkRop,
        });
        if (defer) continue;
      } else if (snapshot.effectiveQty >= calc.reorderPoint) {
        continue;
      }

      let suggestedQty = calc.reorderQty;
      if (wh.regionGroup === 'US' && usPool.effectiveQty < usNetworkRop) {
        const usSales = salesRows
          .filter((s) =>
            s.warehouseCode
              ? US_WAREHOUSE_CODES.includes(s.warehouseCode as (typeof US_WAREHOUSE_CODES)[number])
              : false,
          )
          .map((s) => ({ qtySold: s.qtySold, saleDate: String(s.saleDate) }));
        const networkCalc = calcReplenishment({
          sales: usSales,
          leadTimeDays: leadTime,
          unitCost: sku.unitCost ? Number(sku.unitCost) : 1,
        });
        const split = splitQtyByDailyShare(networkCalc.reorderQty, dailyByWh);
        suggestedQty = split[wh.code] ?? calc.reorderQty;
      }

      if (suggestedQty <= 0) continue;

      const rawQty = suggestedQty;
      suggestedQty = applyMoq(suggestedQty, effectiveMoq);

      const poolNote =
        wh.regionGroup === 'US' ? `，US仓网合计 ${usPool.effectiveQty}/${usNetworkRop}` : '';
      const moqNote =
        effectiveMoq > 0 && suggestedQty > rawQty ? `，MOQ ${effectiveMoq}` : '';
      const reason = `[${wh.code}] 有效 ${snapshot.effectiveQty}，日均 ${calc.avgDaily.toFixed(1)}，ROP ${calc.reorderPoint}${poolNote}${moqNote}`;

      pending.push({
        skuId: sku.id,
        skuCode: sku.code,
        spuId: sku.spuId,
        replenishLight,
        warehouseCode: wh.code,
        suggestedQty,
        suggestedDate: addDays(leadTime),
        reason,
      });
    }
  }

  const spuRedNeeding = new Set<string>();
  for (const item of pending) {
    if (item.replenishLight === 'red' && item.spuId) {
      spuRedNeeding.add(item.spuId);
    }
  }

  for (const item of pending) {
    const eligible = shouldReplenishByLight({
      replenishLight: item.replenishLight,
      needsReplenishment: true,
      spuHasRedNeedingReplenishment: item.spuId ? spuRedNeeding.has(item.spuId) : false,
    });
    if (!eligible) continue;

    await db.insert(reorderSuggestions).values({
      skuId: item.skuId,
      warehouseCode: item.warehouseCode,
      suggestedQty: item.suggestedQty,
      suggestedDate: item.suggestedDate,
      reason: item.reason,
      status: 'pending',
    });

    results.push({
      skuCode: item.skuCode,
      warehouseCode: item.warehouseCode,
      suggestedQty: item.suggestedQty,
      reason: item.reason,
    });
    count++;
  }

  return { suggestionCount: count, engine: 'local-per-warehouse', results };
}
