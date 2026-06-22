import { eq, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, users, roles } from '../_db/index.js';
import { requireSuperAdmin } from '../middleware/auth.js';
export const userRoutes = new Hono();
userRoutes.use('*', requireSuperAdmin);
userRoutes.get('/users', async (c) => {
    const rows = await db
        .select({
        id: users.id,
        name: users.name,
        email: users.email,
        feishuUserId: users.feishuUserId,
        isActive: users.isActive,
        createdAt: users.createdAt,
        roleId: users.roleId,
        roleName: roles.name,
        roleCode: roles.code,
    })
        .from(users)
        .innerJoin(roles, eq(users.roleId, roles.id))
        .orderBy(desc(users.createdAt));
    return c.json(rows);
});
userRoutes.patch('/users/:id', async (c) => {
    const body = await c.req.json();
    const userId = c.req.param('id');
    if (body.roleId) {
        const [role] = await db.select().from(roles).where(eq(roles.id, body.roleId)).limit(1);
        if (!role)
            return c.json({ message: 'Role not found' }, 400);
    }
    const [row] = await db
        .update(users)
        .set({
        ...(body.roleId != null ? { roleId: body.roleId } : {}),
        ...(body.isActive != null ? { isActive: body.isActive } : {}),
        ...(body.name != null ? { name: body.name.trim() } : {}),
    })
        .where(eq(users.id, userId))
        .returning();
    if (!row)
        return c.json({ message: 'User not found' }, 404);
    return c.json(row);
});
