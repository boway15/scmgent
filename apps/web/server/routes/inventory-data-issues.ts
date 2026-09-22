import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, inventoryDataIssues, skus } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { requireMenu } from '../lib/rbac.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { countOpenDataIssuesByType } from '../lib/inventory-data-issue-store.js';

export const inventoryDataIssueRoutes = new Hono();

const MENU = 'inventory.data_issues';

inventoryDataIssueRoutes.get('/inventory/data-issues', requireMenu(MENU), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const status = c.req.query('status');
  const issueType = c.req.query('type');
  const q = c.req.query('q')?.trim();

  const conditions = [];
  if (status) {
    conditions.push(
      eq(
        inventoryDataIssues.status,
        status as 'open' | 'in_progress' | 'resolved' | 'dismissed',
      ),
    );
  } else {
    conditions.push(inArray(inventoryDataIssues.status, ['open', 'in_progress']));
  }
  if (issueType) {
    conditions.push(
      eq(
        inventoryDataIssues.issueType,
        issueType as 'missing_available_at' | 'unallocated_warehouse' | 'share_sum_mismatch',
      ),
    );
  }
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(skus.code, pattern),
        ilike(skus.name, pattern),
        ilike(inventoryDataIssues.warehouseCode, pattern),
        ilike(inventoryDataIssues.example, pattern),
      )!,
    );
  }

  const where = and(...conditions);

  const [rows, countRow, openByType] = await Promise.all([
    db
      .select({
        id: inventoryDataIssues.id,
        fingerprint: inventoryDataIssues.fingerprint,
        skuId: inventoryDataIssues.skuId,
        skuCode: skus.code,
        skuName: skus.name,
        warehouseCode: inventoryDataIssues.warehouseCode,
        issueType: inventoryDataIssues.issueType,
        impactModule: inventoryDataIssues.impactModule,
        example: inventoryDataIssues.example,
        qty: inventoryDataIssues.qty,
        status: inventoryDataIssues.status,
        ownerId: inventoryDataIssues.ownerId,
        resolutionNote: inventoryDataIssues.resolutionNote,
        lastSeenAt: inventoryDataIssues.lastSeenAt,
        createdAt: inventoryDataIssues.createdAt,
        updatedAt: inventoryDataIssues.updatedAt,
      })
      .from(inventoryDataIssues)
      .innerJoin(skus, eq(skus.id, inventoryDataIssues.skuId))
      .where(where)
      .orderBy(desc(inventoryDataIssues.lastSeenAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryDataIssues)
      .innerJoin(skus, eq(skus.id, inventoryDataIssues.skuId))
      .where(where),
    countOpenDataIssuesByType(),
  ]);

  const total = countRow[0]?.count ?? 0;
  return c.json({ items: rows, total, page, pageSize, count: total, openByType });
});

inventoryDataIssueRoutes.patch('/inventory/data-issues/:id', requireMenu(MENU), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    status?: 'open' | 'in_progress' | 'resolved' | 'dismissed';
    ownerId?: string | null;
    resolutionNote?: string;
  }>();

  const [existing] = await db
    .select()
    .from(inventoryDataIssues)
    .where(eq(inventoryDataIssues.id, c.req.param('id')))
    .limit(1);

  if (!existing) return c.json({ message: 'Data issue not found' }, 404);

  const isResolve = body.status === 'resolved' || body.status === 'dismissed';
  const [row] = await db
    .update(inventoryDataIssues)
    .set({
      status: body.status ?? existing.status,
      ownerId: body.ownerId === undefined ? existing.ownerId : body.ownerId,
      resolutionNote: body.resolutionNote ?? existing.resolutionNote,
      resolvedBy: isResolve ? user.id : existing.resolvedBy,
      resolvedAt: isResolve ? new Date() : existing.resolvedAt,
      updatedAt: new Date(),
    })
    .where(eq(inventoryDataIssues.id, existing.id))
    .returning();

  await writeAuditLog(c, {
    action: 'inventory_data_issue.update',
    resourceType: 'inventory_data_issue',
    resourceId: existing.id,
    detail: { status: row.status, resolutionNote: row.resolutionNote },
    user,
  });

  return c.json(row);
});
