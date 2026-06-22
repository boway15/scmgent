import { eq, and, sql, gte, lte, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  db,
  skus,
  stockAlerts,
  reorderSuggestions,
  pmcPlans,
  purchaseDrafts,
  skuCompliance,
  salesHistory,
} from '../_db';
import { deriveComplianceStatus } from '../lib/compliance';

export const dashboardRoutes = new Hono();

type TodoItem = {
  type: string;
  title: string;
  subtitle?: string;
  href: string;
  priority: 'high' | 'medium' | 'low';
};

dashboardRoutes.get('/dashboard', async (c) => {
  const [openAlerts] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stockAlerts)
    .where(eq(stockAlerts.isResolved, false));

  const [pendingReorder] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(reorderSuggestions)
    .where(eq(reorderSuggestions.status, 'pending'));

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

  const complianceRows = await db
    .select({
      skuId: skus.id,
      hsCode: skuCompliance.hsCode,
      weightKg: skuCompliance.weightKg,
      originCountry: skuCompliance.originCountry,
      declaredValue: skuCompliance.declaredValue,
      lengthCm: skuCompliance.lengthCm,
      widthCm: skuCompliance.widthCm,
      heightCm: skuCompliance.heightCm,
      batteryType: skuCompliance.batteryType,
      isLiquid: skuCompliance.isLiquid,
    })
    .from(skus)
    .leftJoin(skuCompliance, eq(skuCompliance.skuId, skus.id))
    .where(eq(skus.isActive, true));

  let complianceComplete = 0;
  let compliancePartial = 0;
  let complianceMissing = 0;
  for (const row of complianceRows) {
    const status = deriveComplianceStatus({
      hsCode: row.hsCode,
      weightKg: row.weightKg,
      originCountry: row.originCountry,
      declaredValue: row.declaredValue,
      lengthCm: row.lengthCm,
      widthCm: row.widthCm,
      heightCm: row.heightCm,
      batteryType: row.batteryType,
      isLiquid: row.isLiquid,
    });
    if (status === 'complete') complianceComplete++;
    else if (status === 'partial') compliancePartial++;
    else complianceMissing++;
  }

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

  if (complianceMissing > 0) {
    todos.push({
      type: 'compliance',
      title: `${complianceMissing} 个 SKU 合规未维护`,
      href: '/compliance/overview',
      priority: 'medium',
    });
  } else if (compliancePartial > 0) {
    todos.push({
      type: 'compliance',
      title: `${compliancePartial} 个 SKU 合规部分缺失`,
      href: '/compliance/overview',
      priority: 'low',
    });
  }

  const priorityOrder = { high: 0, medium: 1, low: 2 };
  todos.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return c.json({
    kpis: {
      openAlerts: openAlerts?.count ?? 0,
      pendingReorderSuggestions: pendingReorder?.count ?? 0,
      draftPmcPlans: draftPlans?.count ?? 0,
      activePmcPlans: activePlans?.count ?? 0,
      purchaseTrackingPending: trackingPending?.count ?? 0,
      complianceComplete,
      compliancePartial,
      complianceMissing,
      activeSkus: activeSkus?.count ?? 0,
      salesQtyLast7Days: sales7d?.total ?? 0,
      openAlertsLast7Days: openAlerts7d?.count ?? 0,
    },
    trends: {
      salesLast7Days: salesTrend7d.map((r) => ({ date: r.date.slice(0, 10), qty: r.qty })),
      salesLast30Days: salesTrend30d.map((r) => ({ date: r.date.slice(0, 10), qty: r.qty })),
    },
    todos,
  });
});
