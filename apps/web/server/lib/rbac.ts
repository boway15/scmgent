import { eq } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { db, roleMenus, menus } from '@scm/db';
import { isAuthRequired } from '../lib/auth-policy.js';
import type { AuthUser } from './auth-context.js';
import { getCurrentUserOptional } from './auth-context.js';

export function isRbacEnforced(): boolean {
  return process.env.ENFORCE_RBAC === 'true' || isAuthRequired();
}

const menuCache = new Map<string, { codes: Set<string>; at: number }>();
const CACHE_TTL_MS = 60_000;

export async function loadRoleMenuCodes(user: AuthUser): Promise<Set<string>> {
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

export function clearMenuCache(userId?: string) {
  if (userId) menuCache.delete(userId);
  else menuCache.clear();
}

export async function resolveRequestUser(c: Context): Promise<AuthUser | null> {
  const existing = c.get('user') as AuthUser | undefined;
  if (existing) return existing;
  return getCurrentUserOptional(c);
}

export async function userHasMenu(user: AuthUser, ...menuCodes: string[]): Promise<boolean> {
  if (user.role.code === 'super_admin') return true;
  const codes = await loadRoleMenuCodes(user);
  return menuCodes.some((m) => codes.has(m));
}

/** Block pending users without any menu from reading business APIs. */
export function requireBusinessRead() {
  return async (c: Context, next: Next) => {
    if (!isRbacEnforced()) return next();

    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD') return next();

    const path = c.req.path;
    if (
      path.startsWith('/api/auth') ||
      path === '/api/health' ||
      path.startsWith('/api/menus') ||
      path.startsWith('/api/me')
    ) {
      return next();
    }

    const user = await resolveRequestUser(c);
    if (!user) return c.json({ message: 'Unauthorized' }, 401);
    c.set('user', user);

    if (user.role.code === 'pending') {
      const codes = await loadRoleMenuCodes(user);
      if (codes.size === 0) return c.json({ message: 'Forbidden' }, 403);
    }

    return next();
  };
}

export function requireMenu(...menuCodes: string[]) {
  return async (c: Context, next: Next) => {
    if (!isRbacEnforced()) return next();

    const user = await resolveRequestUser(c);
    if (!user) return c.json({ message: 'Unauthorized' }, 401);
    c.set('user', user);

    if (await userHasMenu(user, ...menuCodes)) return next();
    return c.json({ message: 'Forbidden' }, 403);
  };
}

/** Reject viewer role on mutating requests (fallback when route has no menu guard). */
export function requireWrite() {
  return async (c: Context, next: Next) => {
    if (!isRbacEnforced()) return next();

    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();

    const user = await resolveRequestUser(c);
    if (!user) return c.json({ message: 'Unauthorized' }, 401);
    c.set('user', user);

    if (user.role.code === 'viewer') {
      return c.json({ message: 'Forbidden' }, 403);
    }
    if (user.role.code === 'pending') {
      const codes = await loadRoleMenuCodes(user);
      if (codes.size === 0) {
        return c.json({ message: 'Forbidden' }, 403);
      }
    }
    return next();
  };
}

const IMPORT_TYPE_MENUS: Record<string, string> = {
  skus: 'data.import',
  inventory: 'data.import',
  sales: 'data.import',
  safety_stock: 'data.import',
  pmc_plans: 'data.import',
};

export function requireImportAccess() {
  return async (c: Context, next: Next) => {
    if (!isRbacEnforced()) return next();

    const user = await resolveRequestUser(c);
    if (!user) return c.json({ message: 'Unauthorized' }, 401);
    c.set('user', user);

    const type = c.req.param('type');
    const menuCode = type ? IMPORT_TYPE_MENUS[type] : 'data.import';
    if (!menuCode) return c.json({ message: 'Invalid import type' }, 400);

    if (await userHasMenu(user, menuCode)) return next();
    return c.json({ message: 'Forbidden' }, 403);
  };
}
