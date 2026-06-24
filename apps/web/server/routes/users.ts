import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, users, roles } from '@scm/db';
import { requireSuperAdmin } from '../middleware/auth.js';
import { hashPassword } from '../lib/password.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { clearMenuCache } from '../lib/rbac.js';

export const userRoutes = new Hono();

userRoutes.get('/users', requireSuperAdmin, async (c) => {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      feishuUserId: users.feishuUserId,
      passwordHash: users.passwordHash,
      isActive: users.isActive,
      createdAt: users.createdAt,
      roleId: users.roleId,
      roleName: roles.name,
      roleCode: roles.code,
    })
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .orderBy(desc(users.createdAt));

  return c.json(
    rows.map(({ passwordHash, ...row }) => ({
      ...row,
      hasPassword: Boolean(passwordHash),
    })),
  );
});

userRoutes.patch('/users/:id', requireSuperAdmin, async (c) => {
  const body = await c.req.json<{ roleId?: string; isActive?: boolean; name?: string }>();
  const userId = c.req.param('id');

  if (body.roleId) {
    const [role] = await db.select().from(roles).where(eq(roles.id, body.roleId)).limit(1);
    if (!role) return c.json({ message: 'Role not found' }, 400);
  }

  const [before] = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      roleId: users.roleId,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!before) return c.json({ message: 'User not found' }, 404);

  const [row] = await db
    .update(users)
    .set({
      ...(body.roleId != null ? { roleId: body.roleId } : {}),
      ...(body.isActive != null ? { isActive: body.isActive } : {}),
      ...(body.name != null ? { name: body.name.trim() } : {}),
    })
    .where(eq(users.id, userId))
    .returning();

  if (!row) return c.json({ message: 'User not found' }, 404);

  clearMenuCache(userId);

  await writeAuditLog(c, {
    action: 'user.update',
    resourceType: 'user',
    resourceId: userId,
    detail: {
      targetEmail: before.email,
      before: { roleId: before.roleId, isActive: before.isActive, name: before.name },
      after: {
        ...(body.roleId != null ? { roleId: body.roleId } : {}),
        ...(body.isActive != null ? { isActive: body.isActive } : {}),
        ...(body.name != null ? { name: body.name.trim() } : {}),
      },
    },
  });

  return c.json(row);
});

userRoutes.patch('/users/:id/password', requireSuperAdmin, async (c) => {
  const body = await c.req.json<{ password?: string }>();
  const password = body.password ?? '';
  const userId = c.req.param('id');

  if (password.length < 8) {
    return c.json({ message: '密码至少 8 位' }, 400);
  }

  const [target] = await db
    .select({
      id: users.id,
      email: users.email,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!target) return c.json({ message: 'User not found' }, 404);

  if (!target.passwordHash) {
    return c.json({ message: '该用户非邮箱注册，无法重置密码' }, 400);
  }

  await db
    .update(users)
    .set({ passwordHash: hashPassword(password) })
    .where(eq(users.id, userId));

  await writeAuditLog(c, {
    action: 'user.password_reset',
    resourceType: 'user',
    resourceId: userId,
    detail: { targetEmail: target.email },
  });

  return c.json({ ok: true });
});
