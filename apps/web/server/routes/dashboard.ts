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

  const [trackingPending] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchaseDrafts)
    .where(eq(purchaseDrafts.status, 'draft'));

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

  if ((trackingPending?.count ?? 0) > 0) {
    todos.push({
      type: 'tracking',
      title: `${trackingPending!.count} 条采购跟单待跟进`,
      href: '/pmc/tracking',
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

  return c.json({
    kpis: {
      openAlerts: openAlerts?.count ?? 0,
      pendingReorderSuggestions: pendingReorder?.count ?? 0,
      draftPmcPlans: draftPlans?.count ?? 0,
      activePmcPlans: activePlans?.count ?? 0,
      purchaseTrackingPending: trackingPending?.count ?? 0,
      activeSkus: activeSkus?.count ?? 0,
      salesQtyLast7Days: sales7d?.total ?? 0,
      openAlertsLast7Days: openAlerts7d?.count ?? 0,
      latestInventoryDate: latestInventory?.recordedDate
        ? String(latestInventory.recordedDate).slice(0, 10)
        : null,
      latestSalesDate: latestSale?.saleDate ? String(latestSale.saleDate).slice(0, 10) : null,
    },
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
