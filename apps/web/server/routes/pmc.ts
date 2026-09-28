import { eq, desc, and, or, ilike, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, pmcPlans, pmcPlanItems, skus, purchaseDrafts } from '@scm/db';
import { analysisOnlyResponse } from '../lib/analysis-only.js';
import { buildPmcPlanCsv, buildPmcPlanXlsx } from '../lib/pmc-export.js';
import { requireMenu } from '../lib/rbac.js';
import { parseListPagination } from '../lib/list-pagination.js';

export const pmcRoutes = new Hono();

pmcRoutes.get('/pmc/plans', async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const status = c.req.query('status')?.trim();
  const q = c.req.query('q')?.trim();

  const conditions = [];
  if (status) {
    conditions.push(
      eq(pmcPlans.status, status as 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled'),
    );
  }
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(pmcPlans.name, pattern),
        ilike(pmcPlans.planNo, pattern),
        ilike(pmcPlans.merchantCode, pattern),
        ilike(pmcPlans.merchantName, pattern),
      )!,
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const base = db.select().from(pmcPlans).$dynamic();

  const [rows, countRow] = await Promise.all([
    (where ? base.where(where) : base)
      .orderBy(desc(pmcPlans.planDate))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(pmcPlans)
      .where(where),
  ]);

  return c.json({
    items: rows,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
});

pmcRoutes.get('/pmc/plans/:id', async (c) => {
  const planId = c.req.param('id');
  const [plan] = await db.select().from(pmcPlans).where(eq(pmcPlans.id, planId)).limit(1);
  if (!plan) return c.json({ message: 'Plan not found' }, 404);

  const items = await db
    .select({
      id: pmcPlanItems.id,
      skuId: pmcPlanItems.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      plannedQty: pmcPlanItems.plannedQty,
      warehouseCode: pmcPlanItems.warehouseCode,
      completedQty: pmcPlanItems.completedQty,
      unit: pmcPlanItems.unit,
      sortOrder: pmcPlanItems.sortOrder,
    })
    .from(pmcPlanItems)
    .innerJoin(skus, eq(skus.id, pmcPlanItems.skuId))
    .where(eq(pmcPlanItems.planId, planId))
    .orderBy(pmcPlanItems.sortOrder);

  const tracking = await db
    .select({
      id: purchaseDrafts.id,
      draftNo: purchaseDrafts.draftNo,
      skuCode: skus.code,
      qty: purchaseDrafts.qty,
      receivedQty: purchaseDrafts.receivedQty,
      status: purchaseDrafts.status,
      planItemId: purchaseDrafts.planItemId,
      confirmedDeliveryDate: purchaseDrafts.confirmedDeliveryDate,
      exceptionReason: purchaseDrafts.exceptionReason,
    })
    .from(purchaseDrafts)
    .innerJoin(skus, eq(skus.id, purchaseDrafts.skuId))
    .where(eq(purchaseDrafts.sourceRefId, planId))
    .orderBy(desc(purchaseDrafts.createdAt));

  return c.json({ ...plan, items, purchaseTracking: tracking });
});

pmcRoutes.get('/pmc/plans/:id/export', async (c) => {
  const planId = c.req.param('id');
  const [plan] = await db.select().from(pmcPlans).where(eq(pmcPlans.id, planId)).limit(1);
  if (!plan) return c.json({ message: 'Plan not found' }, 404);

  const items = await db
    .select({
      skuCode: skus.code,
      skuName: skus.name,
      plannedQty: pmcPlanItems.plannedQty,
      completedQty: pmcPlanItems.completedQty,
      unit: pmcPlanItems.unit,
      warehouseCode: pmcPlanItems.warehouseCode,
      sortOrder: pmcPlanItems.sortOrder,
    })
    .from(pmcPlanItems)
    .innerJoin(skus, eq(skus.id, pmcPlanItems.skuId))
    .where(eq(pmcPlanItems.planId, planId))
    .orderBy(pmcPlanItems.sortOrder);

  const format = c.req.query('format')?.toLowerCase();
  if (format === 'xlsx') {
    const xlsx = await buildPmcPlanXlsx(plan, items);
    return new Response(xlsx, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${plan.planNo}.xlsx"`,
      },
    });
  }

  const csv = buildPmcPlanCsv(plan, items);
  const filename = `${plan.planNo}.csv`;

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

pmcRoutes.post('/pmc/plans', requireMenu('pmc.list'), async (c) => analysisOnlyResponse(c));

pmcRoutes.patch('/pmc/plans/:id/status', requireMenu('pmc.list'), async (c) =>
  analysisOnlyResponse(c),
);

pmcRoutes.put('/pmc/plans/:id/items/:itemId', requireMenu('pmc.list'), async (c) =>
  analysisOnlyResponse(c),
);

pmcRoutes.post('/pmc/plans/:id/items/:itemId/receive', requireMenu('pmc.list'), async (c) =>
  analysisOnlyResponse(c),
);
