import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, roles, roleMenus, menus, users } from '../_db/index.js';
import { requireSuperAdmin } from '../middleware/auth.js';
import { clearMenuCache } from '../lib/rbac.js';
export const roleRoutes = new Hono();
roleRoutes.get('/roles', requireSuperAdmin, async (c) => {
    const rows = await db.select().from(roles).orderBy(roles.code);
    return c.json(rows);
});
roleRoutes.post('/roles', requireSuperAdmin, async (c) => {
    const body = await c.req.json();
    if (!body.name?.trim() || !body.code?.trim()) {
        return c.json({ message: 'name and code required' }, 400);
    }
    const [row] = await db
        .insert(roles)
        .values({
        name: body.name.trim(),
        code: body.code.trim(),
        description: body.description,
        isSystem: false,
    })
        .returning();
    return c.json(row, 201);
});
roleRoutes.put('/roles/:id', requireSuperAdmin, async (c) => {
    const body = await c.req.json();
    const [row] = await db
        .update(roles)
        .set(body)
        .where(eq(roles.id, c.req.param('id')))
        .returning();
    if (!row)
        return c.json({ message: 'Role not found' }, 404);
    return c.json(row);
});
roleRoutes.delete('/roles/:id', requireSuperAdmin, async (c) => {
    const roleId = c.req.param('id');
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId)).limit(1);
    if (!role)
        return c.json({ message: 'Role not found' }, 404);
    if (role.isSystem)
        return c.json({ message: 'Cannot delete system role' }, 400);
    const bound = await db.select().from(users).where(eq(users.roleId, roleId)).limit(1);
    if (bound.length)
        return c.json({ message: 'Role has bound users' }, 400);
    await db.delete(roles).where(eq(roles.id, roleId));
    return c.json({ ok: true });
});
roleRoutes.get('/roles/:id/menus', requireSuperAdmin, async (c) => {
    const rows = await db
        .select({ menuId: roleMenus.menuId, menuCode: menus.code, menuName: menus.name })
        .from(roleMenus)
        .innerJoin(menus, eq(menus.id, roleMenus.menuId))
        .where(eq(roleMenus.roleId, c.req.param('id')));
    return c.json(rows);
});
roleRoutes.put('/roles/:id/menus', requireSuperAdmin, async (c) => {
    const roleId = c.req.param('id');
    const body = await c.req.json();
    await db.delete(roleMenus).where(eq(roleMenus.roleId, roleId));
    if (body.menuIds?.length) {
        await db.insert(roleMenus).values(body.menuIds.map((menuId) => ({ roleId, menuId })));
    }
    clearMenuCache();
    return c.json({ ok: true, count: body.menuIds?.length ?? 0 });
});
