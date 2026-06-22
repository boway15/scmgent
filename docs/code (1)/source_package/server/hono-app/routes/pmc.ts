import { eq, desc, and } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, pmcPlans, pmcPlanItems, skus } from '../_db';
import { getCurrentUser } from '../lib/auth-context';
import { nextPlanNo } from './procurement';
import { generatePurchaseDraftsFromPlan } from '../lib/pmc-plan';
import { buildPmcPlanCsv, buildPmcPlanXlsx } from '../lib/pmc-export';
import { requireMenu } from '../lib/rbac';

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ['confirmed', 'cancelled'],
  confirmed: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
};

export const pmcRoutes = new Hono();

pmcRoutes.get('/pmc/plans', async (c) => {
  const status = c.req.query('status');
  const base = db.select().from(pmcPlans).$dynamic();
  const rows = status
    ? await base.where(eq(pmcPlans.status, status as 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled')).orderBy(desc(pmcPlans.planDate))
    : await base.orderBy(desc(pmcPlans.planDate)).limit(200);
  return c.json(rows);
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

  return c.json({ ...plan, items });
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

pmcRoutes.post('/pmc/plans', requireMenu('pmc.list'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    name: string;
    merchantCode: string;
    merchantName?: string;
    targetWarehouseCode?: string;
    planDate: string;
    deliveryDate: string;
    remark?: string;
    items: Array<{ skuId: string; plannedQty: number; unit?: string; warehouseCode?: string }>;
  }>();

  if (!body.name?.trim() || !body.merchantCode?.trim() || !body.planDate || !body.deliveryDate || !body.items?.length) {
    return c.json({ message: 'name, merchantCode, planDate, deliveryDate, items required' }, 400);
  }

  const planWarehouse =
    body.targetWarehouseCode?.trim() || body.items[0]?.warehouseCode?.trim();
  if (!planWarehouse) {
    return c.json({ message: 'targetWarehouseCode or items[].warehouseCode required' }, 400);
  }

  const planNo = await nextPlanNo();

  const [plan] = await db
    .insert(pmcPlans)
    .values({
      planNo,
      name: body.name.trim(),
      merchantCode: body.merchantCode.trim(),
      merchantName: body.merchantName?.trim(),
      targetWarehouseCode: planWarehouse,
      planDate: new Date(body.planDate),
      deliveryDate: new Date(body.deliveryDate),
      remark: body.remark,
      status: 'draft',
      createdBy: user.id,
    })
    .returning();

  for (let i = 0; i < body.items.length; i++) {
    const item = body.items[i];
    const [sku] = await db.select().from(skus).where(eq(skus.id, item.skuId)).limit(1);
    if (!sku) continue;
    await db.insert(pmcPlanItems).values({
      planId: plan.id,
      skuId: item.skuId,
      plannedQty: item.plannedQty,
      warehouseCode: item.warehouseCode ?? planWarehouse,
      unit: item.unit ?? sku.unit,
      sortOrder: i,
    });
  }

  return c.json(plan, 201);
});

pmcRoutes.patch('/pmc/plans/:id/status', requireMenu('pmc.list'), async (c) => {
  const user = await getCurrentUser(c);
  const planId = c.req.param('id');
  const body = await c.req.json<{ status: string }>();

  const [plan] = await db.select().from(pmcPlans).where(eq(pmcPlans.id, planId)).limit(1);
  if (!plan) return c.json({ message: 'Plan not found' }, 404);

  const allowed = VALID_TRANSITIONS[plan.status] ?? [];
  if (!allowed.includes(body.status)) {
    return c.json({ message: `Cannot transition from ${plan.status} to ${body.status}` }, 400);
  }

  const [updated] = await db
    .update(pmcPlans)
    .set({ status: body.status as typeof plan.status, updatedAt: new Date() })
    .where(eq(pmcPlans.id, planId))
    .returning();

  if (plan.status === 'draft' && body.status === 'confirmed') {
    const drafts = await generatePurchaseDraftsFromPlan(planId, user.id);
    return c.json({ ...updated, purchaseTrackingCount: drafts.length });
  }

  return c.json(updated);
});

pmcRoutes.put('/pmc/plans/:id/items/:itemId', requireMenu('pmc.list'), async (c) => {
  const body = await c.req.json<{ plannedQty?: number; completedQty?: number }>();
  const [row] = await db
    .update(pmcPlanItems)
    .set(body)
    .where(
      and(
        eq(pmcPlanItems.id, c.req.param('itemId')),
        eq(pmcPlanItems.planId, c.req.param('id')),
      ),
    )
    .returning();

  if (!row) return c.json({ message: 'Item not found' }, 404);
  return c.json(row);
});
