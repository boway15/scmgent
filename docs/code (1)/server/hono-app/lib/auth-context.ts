import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { db, users, roles } from '../_db';
import { isFeishuAuthEnabled } from '../integrations/feishu-auth';
import { COOKIE_NAME, verifySessionToken, type SessionPayload } from './session';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  feishuUserId?: string | null;
  role: { id: string; name: string; code: string };
};

const userSelect = {
  id: users.id,
  name: users.name,
  email: users.email,
  feishuUserId: users.feishuUserId,
  roleId: users.roleId,
  roleName: roles.name,
  roleCode: roles.code,
  isActive: users.isActive,
};

async function loadUserById(id: string): Promise<AuthUser | null> {
  const [user] = await db
    .select(userSelect)
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1);

  if (!user || !user.isActive) return null;

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    feishuUserId: user.feishuUserId,
    role: { id: user.roleId, name: user.roleName, code: user.roleCode },
  };
}

/** Dev fallback when Feishu OAuth is not configured */
async function loadDevAdmin(): Promise<AuthUser> {
  const [user] = await db
    .select(userSelect)
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.email, 'admin@scm.local'))
    .limit(1);

  if (!user) {
    throw new Error('Default admin user not found. Run pnpm db:seed first.');
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    feishuUserId: user.feishuUserId,
    role: { id: user.roleId, name: user.roleName, code: user.roleCode },
  };
}

export async function getSessionFromRequest(c: Context): Promise<SessionPayload | null> {
  const token = getCookie(c, COOKIE_NAME);
  if (!token) return null;
  return verifySessionToken(token);
}

export async function getCurrentUser(c?: Context): Promise<AuthUser> {
  if (c) {
    const fromCtx = c.get('user') as AuthUser | undefined;
    if (fromCtx) return fromCtx;

    const session = await getSessionFromRequest(c);
    if (session) {
      const user = await loadUserById(session.sub);
      if (user) return user;
    }
  }

  if (!isFeishuAuthEnabled()) {
    return loadDevAdmin();
  }

  throw new Error('Unauthorized');
}

export async function getCurrentUserOptional(c?: Context): Promise<AuthUser | null> {
  try {
    return await getCurrentUser(c);
  } catch {
    return null;
  }
}

export function requireRole(user: AuthUser, ...allowed: string[]) {
  if (user.role.code === 'super_admin') return;
  if (!allowed.includes(user.role.code)) {
    throw new Error('Forbidden');
  }
}

export async function findOrCreateFeishuUser(info: {
  openId: string;
  name: string;
  email?: string;
}): Promise<AuthUser> {
  const [existing] = await db
    .select(userSelect)
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.feishuUserId, info.openId))
    .limit(1);

  if (existing) {
    if (!existing.isActive) throw new Error('User account is disabled');
    await db
      .update(users)
      .set({ name: info.name })
      .where(eq(users.id, existing.id));

    return {
      id: existing.id,
      name: info.name,
      email: existing.email,
      feishuUserId: existing.feishuUserId,
      role: { id: existing.roleId, name: existing.roleName, code: existing.roleCode },
    };
  }

  const [viewerRole] = await db.select().from(roles).where(eq(roles.code, 'viewer')).limit(1);
  if (!viewerRole) throw new Error('Default viewer role not found. Run pnpm db:seed.');

  const email = info.email?.trim() || `${info.openId}@feishu.local`;

  const [created] = await db
    .insert(users)
    .values({
      feishuUserId: info.openId,
      name: info.name,
      email,
      roleId: viewerRole.id,
      isActive: true,
    })
    .returning({ id: users.id });

  const user = await loadUserById(created.id);
  if (!user) throw new Error('Failed to create user');
  return user;
}
