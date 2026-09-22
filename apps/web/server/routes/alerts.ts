import { eq, desc, and, or, ilike, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, stockAlerts, skus } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { formatAlertSummaryFromRows } from '../lib/replenishment.js';
import { requireMenu } from '../lib/rbac.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { parseListPagination } from '../lib/list-pagination.js';

export const alertRoutes = new Hono();

alertRoutes.get('/alerts', requireMenu('inventory.alert'), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const q = c.req.query('q')?.trim();
  const horizonDays = c.req.query('horizonDays')?.trim();
  const alertType = c.req.query('alertType')?.trim();
  const resolved = c.req.query('resolved')?.trim();

  const conditions = [];
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
      .where(eq(stockAlerts.isResolved, false)),
  ]);

  const openRows = await db
    .select({
      alertType: stockAlerts.alertType,
      skuCode: skus.code,
      currentQty: stockAlerts.currentQty,
      safetyQty: stockAlerts.safetyQty,
    })
    .from(stockAlerts)
    .innerJoin(skus, eq(skus.id, stockAlerts.skuId))
    .where(eq(stockAlerts.isResolved, false))
    .orderBy(desc(stockAlerts.notifiedAt))
    .limit(500);

  const summary = formatAlertSummaryFromRows(openRows);

  return c.json({
    items: rows,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
    summary,
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
