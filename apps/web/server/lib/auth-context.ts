import { eq } from 'drizzle-orm';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { db, users, roles } from '@scm/db';
import { isAuthBypassLogin, isAuthRequired } from '../lib/auth-policy.js';
import { COOKIE_NAME, verifySessionToken, type SessionPayload } from './session.js';
import { hashPassword, verifyPassword } from './password.js';

export const PENDING_ROLE_CODE = 'pending';

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
  passwordHash: users.passwordHash,
  roleId: users.roleId,
  roleName: roles.name,
  roleCode: roles.code,
  isActive: users.isActive,
};

function toAuthUser(row: {
  id: string;
  name: string;
  email: string;
  feishuUserId: string | null;
  roleId: string;
  roleName: string;
  roleCode: string;
}): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    feishuUserId: row.feishuUserId,
    role: { id: row.roleId, name: row.roleName, code: row.roleCode },
  };
}

async function loadUserById(id: string): Promise<AuthUser | null> {
  const [user] = await db
    .select(userSelect)
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id))
    .limit(1);

  if (!user || !user.isActive) return null;
  return toAuthUser(user);
}

/** Emergency bypass only (AUTH_BYPASS_LOGIN / legacy AUTH_DEV_MODE) */
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

  return toAuthUser(user);
}

export async function getPendingRoleId(): Promise<string> {
  const [role] = await db.select({ id: roles.id }).from(roles).where(eq(roles.code, PENDING_ROLE_CODE)).limit(1);
  if (!role) throw new Error(`Role "${PENDING_ROLE_CODE}" not found. Run db migrate/seed.`);
  return role.id;
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

  if (isAuthBypassLogin()) {
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

    return toAuthUser({ ...existing, name: info.name });
  }

  const pendingRoleId = await getPendingRoleId();
  const email = info.email?.trim() || `${info.openId}@feishu.local`;

  const [created] = await db
    .insert(users)
    .values({
      feishuUserId: info.openId,
      name: info.name,
      email,
      roleId: pendingRoleId,
      isActive: true,
    })
    .returning({ id: users.id });

  const user = await loadUserById(created.id);
  if (!user) throw new Error('Failed to create user');
  return user;
}

export async function registerEmailUser(input: {
  email: string;
  password: string;
  name?: string;
}): Promise<AuthUser> {
  const email = input.email.trim().toLowerCase();
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (taken) throw new Error('Email already registered');

  const pendingRoleId = await getPendingRoleId();
  const name = input.name?.trim() || email.split('@')[0] || '用户';

  const [created] = await db
    .insert(users)
    .values({
      name,
      email,
      passwordHash: hashPassword(input.password),
      roleId: pendingRoleId,
      isActive: true,
    })
    .returning({ id: users.id });

  const user = await loadUserById(created.id);
  if (!user) throw new Error('Failed to create user');
  return user;
}

export async function loginEmailUser(email: string, password: string): Promise<AuthUser> {
  const normalized = email.trim().toLowerCase();
  const [row] = await db
    .select(userSelect)
    .from(users)
    .innerJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.email, normalized))
    .limit(1);

  if (!row || !row.passwordHash || !row.isActive) {
    throw new Error('Invalid credentials');
  }

  if (!verifyPassword(password, row.passwordHash)) {
    throw new Error('Invalid credentials');
  }

  return toAuthUser(row);
}
