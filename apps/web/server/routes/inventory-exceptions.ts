import { eq, desc, and, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, inventoryExceptions, skus, users } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import { writeAuditLog } from '../lib/audit-log.js';

export const inventoryExceptionRoutes = new Hono();

inventoryExceptionRoutes.get('/inventory/exceptions', requireMenu('inventory.overview'), async (c) => {
  const status = c.req.query('status');
  const exceptionType = c.req.query('type');

  const conditions = [];
  if (status) {
    conditions.push(eq(inventoryExceptions.status, status as 'open' | 'in_progress' | 'resolved' | 'dismissed'));
  } else {
    conditions.push(inArray(inventoryExceptions.status, ['open', 'in_progress']));
  }
  if (exceptionType) {
    conditions.push(
      eq(
        inventoryExceptions.exceptionType,
        exceptionType as 'stockout' | 'overstock' | 'slow_moving' | 'lifecycle_eol',
      ),
    );
  }

  const rows = await db
    .select({
      id: inventoryExceptions.id,
      skuId: inventoryExceptions.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      warehouseCode: inventoryExceptions.warehouseCode,
      exceptionType: inventoryExceptions.exceptionType,
      healthStatus: inventoryExceptions.healthStatus,
      recommendedAction: inventoryExceptions.recommendedAction,
      status: inventoryExceptions.status,
      ownerId: inventoryExceptions.ownerId,
      dueDate: inventoryExceptions.dueDate,
      resolvedBy: inventoryExceptions.resolvedBy,
      resolvedAt: inventoryExceptions.resolvedAt,
      resolutionNote: inventoryExceptions.resolutionNote,
      createdAt: inventoryExceptions.createdAt,
      updatedAt: inventoryExceptions.updatedAt,
    })
    .from(inventoryExceptions)
    .innerJoin(skus, eq(skus.id, inventoryExceptions.skuId))
    .where(and(...conditions))
    .orderBy(desc(inventoryExceptions.createdAt))
    .limit(200);

  return c.json({ items: rows, count: rows.length });
});

inventoryExceptionRoutes.patch(
  '/inventory/exceptions/:id',
  requireMenu('inventory.overview'),
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{
      status?: 'open' | 'in_progress' | 'resolved' | 'dismissed';
      ownerId?: string;
      dueDate?: string;
      resolutionNote?: string;
    }>();

    const [existing] = await db
      .select()
      .from(inventoryExceptions)
      .where(eq(inventoryExceptions.id, c.req.param('id')))
      .limit(1);

    if (!existing) return c.json({ message: 'Exception not found' }, 404);

    const isResolve = body.status === 'resolved' || body.status === 'dismissed';

    const [row] = await db
      .update(inventoryExceptions)
      .set({
        status: body.status ?? existing.status,
        ownerId: body.ownerId ?? existing.ownerId,
        dueDate: body.dueDate ?? existing.dueDate,
        resolutionNote: body.resolutionNote ?? existing.resolutionNote,
        resolvedBy: isResolve ? user.id : existing.resolvedBy,
        resolvedAt: isResolve ? new Date() : existing.resolvedAt,
        updatedAt: new Date(),
      })
      .where(eq(inventoryExceptions.id, existing.id))
      .returning();

    await writeAuditLog(c, {
      action: 'inventory_exception.update',
      resourceType: 'inventory_exception',
      resourceId: existing.id,
      detail: { status: row.status, resolutionNote: row.resolutionNote },
      user,
    });

    return c.json(row);
  },
);

inventoryExceptionRoutes.get(
  '/inventory/exceptions/owners',
  requireMenu('inventory.overview'),
  async (c) => {
    const rows = await db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .orderBy(users.name);
    return c.json(rows);
  },
);
