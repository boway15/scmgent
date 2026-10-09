import { eq, desc, and, or, ilike, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, stockAlerts, skus } from '@scm/db';
import {
  inventoryRiskViewLabel,
  isAlertActionView,
  stockoutDateFromBandDays,
  type AlertLevel,
  type PriceReason,
} from '../lib/alert-action.js';
import { getInventoryRiskCounts, listClassifiedAlerts, listSkuNetworkAlerts } from '../lib/alert-action-index.js';
import {
  coverageDaysFromQty,
  recommendOrderForNetworkAlert,
  recommendShip,
} from '../lib/alert-horizon-demand.js';
import { resolveShippingLeadDays } from '../lib/replenishment-coverage.js';
import { resolveNetworkForecastCoverage } from '../lib/alert-network-coverage.js';
import { DEFAULT_SAFETY_STOCK_DAYS } from '../lib/replenishment-coverage.js';
import { getShanghaiBusinessDate } from '../lib/inventory-daily-snapshot.js';
import { getCurrentUser } from '../lib/auth-context.js';
import { alertSupplyKey, loadAlertListSupply } from '../lib/alert-list-supply.js';
import { requireMenu } from '../lib/rbac.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { parseProductScope, productScopeSql } from '../lib/planning-accessory-filter.js';
import {
  filterAlertsByRecommendation,
  parseRecommendYesNoQuery,
} from '../lib/alert-recommendation-filter.js';

export const alertRoutes = new Hono();

function finiteDays(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return value;
}

alertRoutes.get('/alerts/summary', requireMenu('inventory.alert'), async (c) => {
  const productScope = parseProductScope(c.req.query('productScope'));
  return c.json(await getInventoryRiskCounts(productScope));
});

alertRoutes.get('/alerts', requireMenu('inventory.alert'), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const q = c.req.query('q')?.trim();
  const horizonDays = c.req.query('horizonDays')?.trim();
  const alertType = c.req.query('alertType')?.trim();
  const resolved = c.req.query('resolved')?.trim();
  const view = c.req.query('view')?.trim();
  const grain = c.req.query('grain')?.trim() === 'sku' ? 'sku' : 'warehouse';
  const levelQuery = c.req.query('level')?.trim();
  const priceReasonQuery = c.req.query('priceReason')?.trim();
  const level = levelQuery === 'l1' || levelQuery === 'l2' || levelQuery === 'l3' ? (levelQuery as AlertLevel) : undefined;
  const priceReason =
    priceReasonQuery === 'already_out' || priceReasonQuery === 'ship_late' || priceReasonQuery === 'not_ready'
      ? (priceReasonQuery as PriceReason)
      : undefined;
  const suggestOrder = parseRecommendYesNoQuery(c.req.query('suggestOrder'));
  const suggestShip = parseRecommendYesNoQuery(c.req.query('suggestShip'));

  const productScope = parseProductScope(c.req.query('productScope'));
  const conditions = [productScopeSql(productScope)];
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(or(ilike(skus.code, pattern), ilike(skus.name, pattern))!);
  }
  if (alertType) conditions.push(eq(stockAlerts.alertType, alertType));
  if (resolved === 'open') conditions.push(eq(stockAlerts.isResolved, false));
  if (resolved === 'done') conditions.push(eq(stockAlerts.isResolved, true));
  if (horizonDays === 'immediate') {
    conditions.push(sql`${stockAlerts.horizonDays} IS NULL`);
  } else if (horizonDays && horizonDays !== 'all') {
    conditions.push(eq(stockAlerts.horizonDays, Number(horizonDays)));
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const selectFields = {
    id: stockAlerts.id,
    skuId: stockAlerts.skuId,
    skuCode: skus.code,
    skuName: skus.name,
    warehouseCode: stockAlerts.warehouseCode,
    alertType: stockAlerts.alertType,
    currentQty: stockAlerts.currentQty,
    safetyQty: stockAlerts.safetyQty,
    horizonDays: stockAlerts.horizonDays,
    projectedQty: stockAlerts.projectedQty,
    projectedStockoutDate: stockAlerts.projectedStockoutDate,
    notifiedAt: stockAlerts.notifiedAt,
    isResolved: stockAlerts.isResolved,
    resolvedAt: stockAlerts.resolvedAt,
    resolvedBy: stockAlerts.resolvedBy,
  };

  if (view === 'all' || isAlertActionView(view)) {
    if (grain === 'sku') {
      let listed = await listSkuNetworkAlerts({
        productScope,
        action: view === 'all' ? 'all' : view,
        level,
        q,
      });
      const today = getShanghaiBusinessDate();
      if (suggestOrder !== undefined || suggestShip !== undefined) {
        listed = await filterAlertsByRecommendation(
          listed.map((row) => ({
            ...row,
            action: row.networkAction,
            daysToStockout: null,
            networkAction: row.networkAction,
            networkPriceReason: row.networkPriceReason,
          })),
          { today, suggestOrder, suggestShip },
        );
      }
      const pageRows = listed.slice(offset, offset + pageSize);
      const supplyByKey = await loadAlertListSupply(
        pageRows.map((row) => ({
          skuId: row.skuId,
          warehouseCode: row.warehouseCode,
          projectedStockoutDate: null,
        })),
      );
      const items = pageRows.map((row) => {
        const supply = supplyByKey.get(alertSupplyKey(row.skuId, row.warehouseCode));
        const network = resolveNetworkForecastCoverage({
          today,
          localQty: supply?.networkLocalQty,
          overseasQty: supply?.networkOverseasQty,
          inTransitQty: supply?.networkInTransitQty,
          forecastDaily: supply?.networkForecastDaily,
          flatDaily: supply?.networkForecastDaily ? null : supply?.networkAvgDaily,
          inTransitWithin45: supply?.networkInTransitWithin45 ?? 0,
          inTransitWithin60: supply?.networkInTransitWithin60 ?? 0,
        });
        const networkAction = row.networkAction === 'none' ? null : row.networkAction;
        const order = recommendOrderForNetworkAlert({
          today,
          coverageDays: network.coverageDays,
          totalLeadDays: supply?.totalLeadDays ?? null,
          safetyStockDays: DEFAULT_SAFETY_STOCK_DAYS,
          horizons: network.horizons,
          networkAction,
          priceReason: row.networkPriceReason,
        });
        const ship = recommendShip({
          today,
          shipWindowCovered: network.horizons?.shipWindowCovered ?? false,
          urgent45: network.horizons?.urgent45 ?? 0,
          ship60: network.horizons?.ship60 ?? 0,
          action: networkAction,
          daysToStockout: finiteDays(network.onHandTransitCoverageDays),
          shippingLeadDays: resolveShippingLeadDays(row.warehouseCode ?? ''),
        });
        const displayView =
          inventoryRiskViewLabel({
            action: row.networkAction,
            priceReason: row.networkPriceReason,
          }) ?? row.networkAction;
        return {
          id: row.id,
          skuId: row.skuId,
          skuCode: row.skuCode,
          skuName: row.skuName,
          warehouseCode: row.warehouseCode,
          alertType: row.networkAction,
          currentQty: 0,
          safetyQty: 0,
          horizonDays: null,
          projectedQty: null,
          projectedStockoutDate: network.stockoutDate,
          notifiedAt: null,
          isResolved: false,
          resolvedAt: null,
          resolvedBy: null,
          grain,
          localQty: supply?.networkLocalQty ?? 0,
          overseasQty: supply?.networkOverseasQty ?? 0,
          inTransitQty: supply?.networkInTransitQty ?? 0,
          futureNeedQty: supply?.networkFutureNeedQty ?? null,
          networkLocalQty: supply?.networkLocalQty ?? null,
          networkOverseasQty: supply?.networkOverseasQty ?? null,
          networkInTransitQty: supply?.networkInTransitQty ?? null,
          networkFutureNeedQty: supply?.networkFutureNeedQty ?? null,
          networkAvgDaily: supply?.networkAvgDaily ?? null,
          turnoverSales7d: supply?.turnoverSales7d ?? null,
          turnoverSales14d: supply?.turnoverSales14d ?? null,
          turnoverSales30d: supply?.turnoverSales30d ?? null,
          networkBandDays: network.coverageDays,
          networkOnHandTransitDays: network.onHandTransitCoverageDays,
          networkStockoutDate: network.stockoutDate,
          demand150: network.horizons?.demand150 ?? null,
          demand120: network.horizons?.demand120 ?? null,
          demand90: network.horizons?.demand90 ?? null,
          gap90: network.horizons?.gap90 ?? null,
          gap120: network.horizons?.gap120 ?? null,
          gap150: network.horizons?.gap150 ?? null,
          orderByDate: order.orderByDate,
          orderQty: order.orderQty,
          orderNow: order.orderNow,
          orderOverseasReference: order.orderOverseasReference ?? false,
          ship60: network.horizons?.ship60 ?? null,
          urgent45: network.horizons?.urgent45 ?? null,
          shipByDate: ship.shipByDate,
          shipQty: ship.shipQty,
          shipNow: ship.shipNow,
          orderWindowCovered: network.horizons?.windowCovered ?? false,
          shipWindowCovered: network.horizons?.shipWindowCovered ?? false,
          onHandCoverageDays: network.coverageDays,
          inTransitCoverageDays: null,
          warehouseOnHandTransitDays: network.onHandTransitCoverageDays,
          inTransitUndatedQty: supply?.networkInTransitUndatedQty ?? 0,
          action: displayView,
          priceReason: row.networkPriceReason,
          level: row.level,
          ownerLabel: '',
          hasShippableLots: row.hasShippableLots,
          hasUnallocatedLocal: false,
          daysToStockout: finiteDays(network.onHandTransitCoverageDays),
          coverageDays: network.coverageDays,
          bandDays: network.coverageDays,
        };
      });
      return c.json({
        items,
        total: listed.length,
        page,
        pageSize,
        openCount: listed.length,
        grain,
      });
    }

    const classified = await listClassifiedAlerts({
      productScope,
      action: view === 'all' ? 'all' : view,
      level,
      priceReason,
      q,
    });
    let listed = classified;
    const today = getShanghaiBusinessDate();
    if (suggestOrder !== undefined || suggestShip !== undefined) {
      listed = await filterAlertsByRecommendation(listed, { today, suggestOrder, suggestShip });
    }
    const pageRows = listed.slice(offset, offset + pageSize);
    const ids = pageRows.map((row) => row.id);
    const selected = ids.length
      ? await db
          .select(selectFields)
          .from(stockAlerts)
          .innerJoin(skus, eq(skus.id, stockAlerts.skuId))
          .where(inArray(stockAlerts.id, ids))
      : [];
    const byId = new Map(selected.map((row) => [row.id, row]));
    const ordered = pageRows.flatMap((row) => {
      const found = byId.get(row.id);
      return found ? [found] : [];
    });
    const classById = new Map(pageRows.map((row) => [row.id, row]));
    const supplyByKey = await loadAlertListSupply(
      ordered.map((row) => ({
        skuId: row.skuId,
        warehouseCode: row.warehouseCode,
        projectedStockoutDate: row.projectedStockoutDate,
      })),
    );
    const items = ordered.map((row) => {
      const supply = supplyByKey.get(alertSupplyKey(row.skuId, row.warehouseCode));
      const classifiedRow = classById.get(row.id);
      const action =
        (classifiedRow
          ? inventoryRiskViewLabel({
              action: classifiedRow.action,
              priceReason: classifiedRow.priceReason,
            })
          : null) ?? (view === 'all' ? null : view);
      const warehouseDays = finiteDays(classifiedRow?.bandDays);
      const network = resolveNetworkForecastCoverage({
        today,
        localQty: supply?.networkLocalQty,
        overseasQty: supply?.networkOverseasQty,
        inTransitQty: supply?.networkInTransitQty,
        forecastDaily: supply?.networkForecastDaily,
        flatDaily: supply?.networkForecastDaily ? null : supply?.networkAvgDaily,
        inTransitWithin45: supply?.networkInTransitWithin45 ?? 0,
        inTransitWithin60: supply?.networkInTransitWithin60 ?? 0,
      });
      const inTransitCoverageDays = coverageDaysFromQty(
        supply?.inTransitQty ?? 0,
        supply?.warehouseAvgDaily,
      );
      const warehouseOnHandTransitDays = coverageDaysFromQty(
        (supply?.overseasQty ?? 0) + (supply?.inTransitQty ?? 0),
        supply?.warehouseAvgDaily,
      );
      const shipAction =
        classifiedRow?.action === 'none' || classifiedRow?.action == null ? null : classifiedRow.action;
      const order = recommendOrderForNetworkAlert({
        today,
        coverageDays: network.coverageDays,
        totalLeadDays: supply?.totalLeadDays ?? null,
        safetyStockDays: DEFAULT_SAFETY_STOCK_DAYS,
        horizons: network.horizons,
        networkAction: shipAction,
        priceReason: classifiedRow?.priceReason ?? null,
      });
      const ship = recommendShip({
        today,
        shipWindowCovered: network.horizons?.shipWindowCovered ?? false,
        urgent45: network.horizons?.urgent45 ?? 0,
        ship60: network.horizons?.ship60 ?? 0,
        action: shipAction,
        daysToStockout: classifiedRow?.daysToStockout ?? null,
        shippingLeadDays: resolveShippingLeadDays(row.warehouseCode ?? ''),
      });
      return {
        ...row,
        grain,
        localQty: supply?.localQty ?? 0,
        overseasQty: supply?.overseasQty ?? 0,
        inTransitQty: supply?.inTransitQty ?? 0,
        futureNeedQty: supply?.futureNeedQty ?? null,
        projectedStockoutDate:
          stockoutDateFromBandDays(today, warehouseDays) ??
          supply?.projectedStockoutDate ??
          row.projectedStockoutDate,
        networkLocalQty: supply?.networkLocalQty ?? null,
        networkOverseasQty: supply?.networkOverseasQty ?? null,
        networkInTransitQty: supply?.networkInTransitQty ?? null,
        networkFutureNeedQty: supply?.networkFutureNeedQty ?? null,
        networkAvgDaily: supply?.networkAvgDaily ?? null,
        turnoverSales7d: supply?.turnoverSales7d ?? null,
        turnoverSales14d: supply?.turnoverSales14d ?? null,
        turnoverSales30d: supply?.turnoverSales30d ?? null,
        networkBandDays: network.coverageDays,
        networkOnHandTransitDays: network.onHandTransitCoverageDays,
        networkStockoutDate: network.stockoutDate,
        demand150: network.horizons?.demand150 ?? null,
        demand120: network.horizons?.demand120 ?? null,
        demand90: network.horizons?.demand90 ?? null,
        gap90: network.horizons?.gap90 ?? null,
        gap120: network.horizons?.gap120 ?? null,
        gap150: network.horizons?.gap150 ?? null,
        orderByDate: order.orderByDate,
        orderQty: order.orderQty,
        orderNow: order.orderNow,
        orderOverseasReference: order.orderOverseasReference ?? false,
        ship60: network.horizons?.ship60 ?? null,
        urgent45: network.horizons?.urgent45 ?? null,
        shipByDate: ship.shipByDate,
        shipQty: ship.shipQty,
        shipNow: ship.shipNow,
        orderWindowCovered: network.horizons?.windowCovered ?? false,
        shipWindowCovered: network.horizons?.shipWindowCovered ?? false,
        onHandCoverageDays: classifiedRow?.onHandCoverageDays ?? null,
        inTransitCoverageDays: Number.isFinite(inTransitCoverageDays) ? inTransitCoverageDays : null,
        warehouseOnHandTransitDays: Number.isFinite(warehouseOnHandTransitDays) ? warehouseOnHandTransitDays : null,
        inTransitUndatedQty: supply?.inTransitUndatedQty ?? 0,
        action,
        priceReason: classifiedRow?.priceReason ?? null,
        level: classifiedRow?.level ?? null,
        ownerLabel: classifiedRow?.ownerLabel ?? '',
        hasShippableLots: classifiedRow?.hasShippableLots ?? false,
        hasUnallocatedLocal: classifiedRow?.hasUnallocatedLocal ?? false,
        daysToStockout: classifiedRow?.daysToStockout ?? null,
        coverageDays: classifiedRow?.coverageDays ?? null,
        bandDays: classifiedRow?.bandDays ?? null,
      };
    });
    return c.json({
      items,
      total: listed.length,
      page,
      pageSize,
      openCount: listed.length,
      grain,
    });
  }

function dedupeAlertsBySku<T extends { skuId: string; level: string | null }>(rows: T[]): T[] {
  const rank: Record<string, number> = { l3: 0, l2: 1, l1: 2 };
  const bySku = new Map<string, T>();
  for (const row of rows) {
    const prev = bySku.get(row.skuId);
    if (!prev) {
      bySku.set(row.skuId, row);
      continue;
    }
    const prevRank = rank[prev.level ?? ''] ?? 3;
    const nextRank = rank[row.level ?? ''] ?? 3;
    if (nextRank < prevRank) bySku.set(row.skuId, row);
  }
  return [...bySku.values()];
}

  const base = db
    .select(selectFields)
    .from(stockAlerts)
    .innerJoin(skus, eq(skus.id, stockAlerts.skuId))
    .$dynamic();

  const [rows, countRow, openCountRow] = await Promise.all([
    (where ? base.where(where) : base)
      .orderBy(desc(stockAlerts.notifiedAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(stockAlerts)
      .innerJoin(skus, eq(skus.id, stockAlerts.skuId))
      .where(where),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(stockAlerts)
      .innerJoin(skus, eq(skus.id, stockAlerts.skuId))
      .where(and(eq(stockAlerts.isResolved, false), productScopeSql(productScope))),
  ]);

  const supplyByKey = await loadAlertListSupply(
    rows.map((row) => ({
      skuId: row.skuId,
      warehouseCode: row.warehouseCode,
      projectedStockoutDate: row.projectedStockoutDate,
    })),
  );
  const items = rows.map((row) => {
    const supply = supplyByKey.get(alertSupplyKey(row.skuId, row.warehouseCode));
    return {
      ...row,
      localQty: supply?.localQty ?? 0,
      overseasQty: supply?.overseasQty ?? 0,
      inTransitQty: supply?.inTransitQty ?? 0,
      futureNeedQty: supply?.futureNeedQty ?? null,
      projectedStockoutDate: supply?.projectedStockoutDate ?? row.projectedStockoutDate,
      networkLocalQty: supply?.networkLocalQty ?? null,
      networkOverseasQty: supply?.networkOverseasQty ?? null,
      networkInTransitQty: supply?.networkInTransitQty ?? null,
      networkFutureNeedQty: supply?.networkFutureNeedQty ?? null,
      networkStockoutDate: resolveNetworkForecastCoverage({
        today: getShanghaiBusinessDate(),
        localQty: supply?.networkLocalQty,
        overseasQty: supply?.networkOverseasQty,
        inTransitQty: supply?.networkInTransitQty,
        forecastDaily: supply?.networkForecastDaily,
        flatDaily: supply?.networkForecastDaily ? null : supply?.networkAvgDaily,
      }).stockoutDate,
    };
  });

  return c.json({
    items,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
    openCount: openCountRow[0]?.count ?? 0,
  });
});

alertRoutes.patch('/alerts/:id/resolve', requireMenu('inventory.alert'), async (c) => {
  const user = await getCurrentUser(c);
  const [row] = await db
    .update(stockAlerts)
    .set({ isResolved: true, resolvedAt: new Date(), resolvedBy: user.id })
    .where(eq(stockAlerts.id, c.req.param('id')))
    .returning();

  if (!row) return c.json({ message: 'Alert not found' }, 404);

  await writeAuditLog(c, {
    action: 'stock_alert.resolve',
    resourceType: 'stock_alert',
    resourceId: row.id,
    user,
  });

  return c.json(row);
});
