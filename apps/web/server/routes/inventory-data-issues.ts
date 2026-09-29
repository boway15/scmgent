import { and, eq, inArray, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, inventoryDataIssues, skus } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { requireMenu } from '../lib/rbac.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { countOpenDataIssuesByType } from '../lib/inventory-data-issue-store.js';
import {
  buildInventoryDataIssueExportCsv,
  listInventoryDataIssueRows,
  listInventoryDataIssueRowsForExport,
  parseInventoryDataIssueListFilters,
} from '../lib/inventory-data-issue-list.js';
import { buildCsv, csvAttachment } from '../lib/csv-export.js';
import { productScopeSql } from '../lib/planning-accessory-filter.js';

export const inventoryDataIssueRoutes = new Hono();

const MENU = 'inventory.data_issues';

inventoryDataIssueRoutes.get('/inventory/data-issues/export', requireMenu(MENU), async (c) => {
  const filters = parseInventoryDataIssueListFilters({
    status: c.req.query('status'),
    type: c.req.query('type'),
    q: c.req.query('q'),
    productScope: c.req.query('productScope'),
  });
  const { items, truncated } = await listInventoryDataIssueRowsForExport(filters);
  const { headers, bodyRows } = buildInventoryDataIssueExportCsv(items);
  const csv = buildCsv(headers, bodyRows);
  const date = new Date().toISOString().slice(0, 10);
  const scope = filters.productScope === 'accessory' ? 'accessory' : 'goods';
  const suffix = truncated ? '-truncated' : '';
  return csvAttachment(`inventory-data-issues-${date}-${scope}${suffix}.csv`, csv);
});

inventoryDataIssueRoutes.get('/inventory/data-issues', requireMenu(MENU), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const filters = parseInventoryDataIssueListFilters({
    status: c.req.query('status'),
    type: c.req.query('type'),
    q: c.req.query('q'),
    productScope: c.req.query('productScope'),
  });

  const { items, total } = await listInventoryDataIssueRows({ filters, limit: pageSize, offset });

  const [openByType, accessoryCountRow] = await Promise.all([
    countOpenDataIssuesByType(),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(inventoryDataIssues)
      .innerJoin(skus, eq(skus.id, inventoryDataIssues.skuId))
      .where(
        and(
          inArray(inventoryDataIssues.status, ['open', 'in_progress']),
          productScopeSql('accessory'),
        ),
      ),
  ]);

  return c.json({
    items,
    total,
    page,
    pageSize,
    count: total,
    openByType,
    accessoryOpenCount: accessoryCountRow[0]?.count ?? 0,
  });
});

inventoryDataIssueRoutes.patch('/inventory/data-issues/:id', requireMenu(MENU), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    status?: 'open' | 'in_progress' | 'resolved' | 'dismissed';
    ownerId?: string | null;
    resolutionNote?: string;
  }>();

  if (body.status && body.status !== 'dismissed') {
    return c.json(
      {
        message:
          '数据问题源字段在迅捷维护，本系统仅支持标记「已知悉」。修正后由扫描自动结案。',
      },
      400,
    );
  }

  const [existing] = await db
    .select()
    .from(inventoryDataIssues)
    .where(eq(inventoryDataIssues.id, c.req.param('id')))
    .limit(1);

  if (!existing) return c.json({ message: 'Data issue not found' }, 404);

  const nextStatus = body.status ?? existing.status;
  const isDismiss = nextStatus === 'dismissed';
  const [row] = await db
    .update(inventoryDataIssues)
    .set({
      status: nextStatus,
      ownerId: body.ownerId === undefined ? existing.ownerId : body.ownerId,
      resolutionNote: body.resolutionNote ?? existing.resolutionNote,
      resolvedBy: isDismiss ? user.id : existing.resolvedBy,
      resolvedAt: isDismiss ? new Date() : existing.resolvedAt,
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
