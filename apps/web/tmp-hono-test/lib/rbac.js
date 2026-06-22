import { eq } from 'drizzle-orm';
import { db, roleMenus, menus } from '../_db/index.js';
import { isFeishuAuthEnabled } from '../integrations/feishu-auth.js';
import { getCurrentUserOptional } from './auth-context.js';
export function isRbacEnforced() {
    return process.env.ENFORCE_RBAC === 'true' || isFeishuAuthEnabled();
}
const menuCache = new Map();
const CACHE_TTL_MS = 60_000;
export async function loadRoleMenuCodes(user) {
    if (user.role.code === 'super_admin') {
        return new Set(['*']);
    }
    const cached = menuCache.get(user.id);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.codes;
    }
    const rows = await db
        .select({ code: menus.code })
        .from(roleMenus)
        .innerJoin(menus, eq(roleMenus.menuId, menus.id))
        .where(eq(roleMenus.roleId, user.role.id));
    const codes = new Set(rows.map((r) => r.code));
    menuCache.set(user.id, { codes, at: Date.now() });
    return codes;
}
export function clearMenuCache(userId) {
    if (userId)
        menuCache.delete(userId);
    else
        menuCache.clear();
}
export async function resolveRequestUser(c) {
    const existing = c.get('user');
    if (existing)
        return existing;
    return getCurrentUserOptional(c);
}
export async function userHasMenu(user, ...menuCodes) {
    if (user.role.code === 'super_admin')
        return true;
    const codes = await loadRoleMenuCodes(user);
    return menuCodes.some((m) => codes.has(m));
}
export function requireMenu(...menuCodes) {
    return async (c, next) => {
        if (!isRbacEnforced())
            return next();
        const user = await resolveRequestUser(c);
        if (!user)
            return c.json({ message: 'Unauthorized' }, 401);
        c.set('user', user);
        if (await userHasMenu(user, ...menuCodes))
            return next();
        return c.json({ message: 'Forbidden' }, 403);
    };
}
/** Reject viewer role on mutating requests (fallback when route has no menu guard). */
export function requireWrite() {
    return async (c, next) => {
        if (!isRbacEnforced())
            return next();
        const method = c.req.method;
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS')
            return next();
        const user = await resolveRequestUser(c);
        if (!user)
            return c.json({ message: 'Unauthorized' }, 401);
        c.set('user', user);
        if (user.role.code === 'viewer') {
            return c.json({ message: 'Forbidden' }, 403);
        }
        return next();
    };
}
const IMPORT_TYPE_MENUS = {
    skus: 'data.import',
    inventory: 'data.import',
    sales: 'data.import',
    safety_stock: 'data.import',
    pmc_plans: 'data.import',
};
export function requireImportAccess() {
    return async (c, next) => {
        if (!isRbacEnforced())
            return next();
        const user = await resolveRequestUser(c);
        if (!user)
            return c.json({ message: 'Unauthorized' }, 401);
        c.set('user', user);
        const type = c.req.param('type');
        const menuCode = type ? IMPORT_TYPE_MENUS[type] : 'data.import';
        if (!menuCode)
            return c.json({ message: 'Invalid import type' }, 400);
        if (await userHasMenu(user, menuCode))
            return next();
        return c.json({ message: 'Forbidden' }, 403);
    };
}
