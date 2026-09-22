import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, auditLogs } from '@scm/db';
import { parseListPagination } from '../lib/list-pagination.js';
import { requireSuperAdmin } from '../middleware/auth.js';

export const auditLogRoutes = new Hono();

auditLogRoutes.get('/audit-logs', requireSuperAdmin, async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
    50,
  );
  const action = c.req.query('action')?.trim();
  const userId = c.req.query('userId')?.trim();
  const q = c.req.query('q')?.trim();

  const conditions = [];
  if (action) conditions.push(eq(auditLogs.action, action));
  if (userId) conditions.push(eq(auditLogs.userId, userId));
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(auditLogs.action, pattern),
        ilike(auditLogs.userName, pattern),
        ilike(auditLogs.userEmail, pattern),
        ilike(auditLogs.detail, pattern),
        ilike(auditLogs.resourceType, pattern),
        ilike(auditLogs.resourceId, pattern),
      )!,
    );
  }

  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: auditLogs.id,
        userId: auditLogs.userId,
        userName: auditLogs.userName,
        userEmail: auditLogs.userEmail,
        action: auditLogs.action,
        resourceType: auditLogs.resourceType,
        resourceId: auditLogs.resourceId,
        detail: auditLogs.detail,
        ipAddress: auditLogs.ipAddress,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(auditLogs)
      .where(where),
  ]);

  return c.json({
    items: rows,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
});
