import { eq, and, sql, gte, lte, inArray, desc, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  db,
  skus,
  stockAlerts,
  reorderSuggestions,
  pmcPlans,
  purchaseDrafts,
  salesHistory,
  inventoryRecords,
} from '@scm/db';
import { getLatestTaskRun } from '../lib/task-runs.js';
import { requireMenu } from '../lib/rbac.js';
import { getPrimaryPublishedVersionId, getForecastVersionById } from '../lib/forecast-version.js';
import { listForecastAccuracy } from '../lib/forecast-accuracy.js';

export const dashboardRoutes = new Hono();

type TodoItem = {
  type: string;
  title: string;
  subtitle?: string;
  href: string;
  priority: 'high' | 'medium' | 'low';
};

dashboardRoutes.get('/dashboard', requireMenu('dashboard'), async (c) => {
  const [openAlerts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockAlerts)
    .where(eq(stockAlerts.isResolved, false));

  const [pendingReorder] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reorderSuggestions)
    .where(
      and(eq(reorderSuggestions.status, 'pending'), isNull(reorderSuggestions.supersededAt)),
    );

  const [draftPlans] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pmcPlans)
    .where(eq(pmcPlans.status, 'draft'));

  const [activePlans] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pmcPlans)
    .where(inArray(pmcPlans.status, ['confirmed', 'in_progress']));

  const [trackingPendingConfirm] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseDrafts)
    .where(and(eq(purchaseDrafts.source, 'pmc'), eq(purchaseDrafts.status, 'draft')));

  const [trackingInFulfillment] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseDrafts)
    .where(
      and(
        eq(purchaseDrafts.source, 'pmc'),
        inArray(purchaseDrafts.status, ['confirmed', 'submitted', 'in_production', 'ready_to_ship']),
      ),
    );

  const [trackingInTransit] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseDrafts)
    .where(
      and(
        eq(purchaseDrafts.source, 'pmc'),
        inArray(purchaseDrafts.status, ['in_transit', 'partial_received']),
      ),
    );

  const [trackingException] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseDrafts)
    .where(and(eq(purchaseDrafts.source, 'pmc'), eq(purchaseDrafts.status, 'exception')));

  const [trackingReceived] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseDrafts)
    .where(and(eq(purchaseDrafts.source, 'pmc'), eq(purchaseDrafts.status, 'received')));

  const [activeSkus] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(skus)
    .where(eq(skus.isActive, true));

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const fromStr = sevenDaysAgo.toISOString().slice(0, 10);

  const [sales7d] = await db
    .select({ total: sql<number>`coalesce(sum(${salesHistory.qtySold}), 0)::int` })
    .from(salesHistory)
    .where(gte(salesHistory.saleDate, fromStr));

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const from30 = thirtyDaysAgo.toISOString().slice(0, 10);

  const salesTrend7d = await db
    .select({
      date: sql<string>`${salesHistory.saleDate}::text`,
      qty: sql<number>`coalesce(sum(${salesHistory.qtySold}), 0)::int`,
    })
    .from(salesHistory)
    .where(gte(salesHistory.saleDate, fromStr))
    .groupBy(salesHistory.saleDate)
    .orderBy(salesHistory.saleDate);

  const salesTrend30d = await db
    .select({
      date: sql<string>`${salesHistory.saleDate}::text`,
      qty: sql<number>`coalesce(sum(${salesHistory.qtySold}), 0)::int`,
    })
    .from(salesHistory)
    .where(gte(salesHistory.saleDate, from30))
    .groupBy(salesHistory.saleDate)
    .orderBy(salesHistory.saleDate);

  const [openAlerts7d] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockAlerts)
    .where(
      and(
        eq(stockAlerts.isResolved, false),
        gte(stockAlerts.notifiedAt, sevenDaysAgo),
      ),
    );

  const publishedVersionId = await getPrimaryPublishedVersionId();
  const publishedVersion = await getForecastVersionById(publishedVersionId);
  const accuracyResult = await listForecastAccuracy({ limit: 500 });
  const highMapeCount = accuracyResult.items.filter((r) => r.mape != null && r.mape > 0.3).length;

  const todos: TodoItem[] = [];

  if ((openAlerts?.count ?? 0) > 0) {
    todos.push({
      type: 'alert',
      title: `${openAlerts!.count} 条缺货预警待处理`,
      href: '/inventory/alerts',
      priority: 'high',
    });
  }

  if ((pendingReorder?.count ?? 0) > 0) {
    todos.push({
      type: 'reorder',
      title: `${pendingReorder!.count} 条补货建议待采纳`,
      href: '/pmc/suggestions',
      priority: 'high',
    });
  }

  if ((draftPlans?.count ?? 0) > 0) {
    todos.push({
      type: 'pmc_draft',
      title: `${draftPlans!.count} 个 PMC 草稿计划待确认`,
      subtitle: '确认后可生成采购跟单，并导出 CSV 发给商家',
      href: '/pmc/list',
      priority: 'medium',
    });
  }

  if ((trackingPendingConfirm?.count ?? 0) > 0) {
    todos.push({
      type: 'tracking_confirm',
      title: `${trackingPendingConfirm!.count} 条采购跟单待供应商确认`,
      href: '/pmc/tracking',
      priority: 'high',
    });
  }

  if ((trackingException?.count ?? 0) > 0) {
    todos.push({
      type: 'tracking_exception',
      title: `${trackingException!.count} 条采购跟单异常待处理`,
      href: '/pmc/tracking?status=exception',
      priority: 'high',
    });
  }

  if ((trackingInTransit?.count ?? 0) > 0) {
    todos.push({
      type: 'tracking_transit',
      title: `${trackingInTransit!.count} 条跟单在途或部分到货`,
      subtitle: '请登记到货以回写库存',
      href: '/pmc/tracking',
      priority: 'medium',
    });
  }

  const deliverySoon = await db
    .select({
      planNo: pmcPlans.planNo,
      name: pmcPlans.name,
      deliveryDate: pmcPlans.deliveryDate,
    })
    .from(pmcPlans)
    .where(
      and(
        inArray(pmcPlans.status, ['confirmed', 'in_progress']),
        lte(pmcPlans.deliveryDate, new Date(Date.now() + 14 * 86400000)),
        gte(pmcPlans.deliveryDate, new Date()),
      ),
    )
    .orderBy(pmcPlans.deliveryDate)
    .limit(5);

  for (const p of deliverySoon) {
    todos.push({
      type: 'pmc_delivery',
      title: `计划 ${p.planNo} 交期临近`,
      subtitle: `${p.name} · ${String(p.deliveryDate).slice(0, 10)}`,
      href: '/pmc/list',
      priority: 'medium',
    });
  }

  if (highMapeCount > 0) {
    todos.push({
      type: 'forecast_risk',
      title: `${highMapeCount} 个 SKU 预测偏差偏高（MAPE>30%）`,
      subtitle: publishedVersion
        ? `当前补货口径：${publishedVersion.versionNo}`
        : undefined,
      href: '/data/forecast?tab=accuracy',
      priority: 'low',
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  todos.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  const [latestInventory] = await db
    .select({ recordedDate: inventoryRecords.recordedDate })
    .from(inventoryRecords)
    .orderBy(desc(inventoryRecords.recordedDate), desc(inventoryRecords.createdAt))
    .limit(1);

  const [latestSale] = await db
    .select({ saleDate: salesHistory.saleDate })
    .from(salesHistory)
    .orderBy(desc(salesHistory.saleDate), desc(salesHistory.createdAt))
    .limit(1);

  const [stockAlertRun, replenishmentRun, purchaseFollowUpRun, dailyPipelineRun] =
    await Promise.all([
      getLatestTaskRun('stock_alert'),
      getLatestTaskRun('replenishment_forecast'),
      getLatestTaskRun('purchase_follow_up'),
      getLatestTaskRun('daily_inventory_pipeline'),
    ]);

  const loopFunnel = {
    pendingReorderSuggestions: pendingReorder?.count ?? 0,
    draftPmcPlans: draftPlans?.count ?? 0,
    activePmcPlans: activePlans?.count ?? 0,
    trackingPendingConfirm: trackingPendingConfirm?.count ?? 0,
    trackingInFulfillment: trackingInFulfillment?.count ?? 0,
    trackingInTransit: trackingInTransit?.count ?? 0,
    trackingException: trackingException?.count ?? 0,
    trackingReceived: trackingReceived?.count ?? 0,
  };

  return c.json({
    kpis: {
      openAlerts: openAlerts?.count ?? 0,
      pendingReorderSuggestions: pendingReorder?.count ?? 0,
      draftPmcPlans: draftPlans?.count ?? 0,
      activePmcPlans: activePlans?.count ?? 0,
      purchaseTrackingPending: trackingPendingConfirm?.count ?? 0,
      activeSkus: activeSkus?.count ?? 0,
      salesQtyLast7Days: sales7d?.total ?? 0,
      openAlertsLast7Days: openAlerts7d?.count ?? 0,
      latestInventoryDate: latestInventory?.recordedDate
        ? String(latestInventory.recordedDate).slice(0, 10)
        : null,
      latestSalesDate: latestSale?.saleDate ? String(latestSale.saleDate).slice(0, 10) : null,
    },
    loopFunnel,
    forecastContext: publishedVersion
      ? {
          versionId: publishedVersion.id,
          versionNo: publishedVersion.versionNo,
          publishedAt: publishedVersion.publishedAt,
          highMapeSkuCount: highMapeCount,
        }
      : null,
    dataFreshness: {
      latestInventoryDate: latestInventory?.recordedDate
        ? String(latestInventory.recordedDate).slice(0, 10)
        : null,
      latestSalesDate: latestSale?.saleDate ? String(latestSale.saleDate).slice(0, 10) : null,
    },
    taskRuns: {
      stockAlert: stockAlertRun,
      replenishmentForecast: replenishmentRun,
      purchaseFollowUp: purchaseFollowUpRun,
      dailyInventoryPipeline: dailyPipelineRun,
    },
    trends: {
      salesLast7Days: salesTrend7d.map((r) => ({ date: r.date.slice(0, 10), qty: r.qty })),
      salesLast30Days: salesTrend30d.map((r) => ({ date: r.date.slice(0, 10), qty: r.qty })),
    },
    todos,
  });
});
