import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomBytes } from 'crypto';
import {
  buildFeishuAuthorizeUrl,
  exchangeCodeForUser,
  isAuthBypassLogin,
  isEmailAuthEnabled,
  isFeishuLoginAvailable,
} from '../integrations/feishu-auth.js';
import {
  COOKIE_NAME,
  MAX_AGE_SEC,
  createSessionToken,
} from '../lib/session.js';
import {
  findOrCreateFeishuUser,
  getCurrentUser,
  getCurrentUserOptional,
  loginEmailUser,
  registerEmailUser,
} from '../lib/auth-context.js';
import { writeAuditLog } from '../lib/audit-log.js';

export const authRoutes = new Hono();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string) {
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: MAX_AGE_SEC,
    path: '/',
  });
}

async function issueSession(c: Parameters<typeof setCookie>[0], user: Awaited<ReturnType<typeof getCurrentUser>>) {
  const token = await createSessionToken({
    sub: user.id,
    email: user.email,
    roleCode: user.role.code,
  });
  setSessionCookie(c, token);
  return user;
}

authRoutes.get('/auth/config', (c) =>
  c.json({
    feishuEnabled: isFeishuLoginAvailable(),
    emailAuthEnabled: isEmailAuthEnabled(),
    authBypass: isAuthBypassLogin(),
  }),
);

authRoutes.post('/auth/register', async (c) => {
  if (!isEmailAuthEnabled()) {
    return c.json({ message: 'Email registration is disabled' }, 403);
  }

  const body = await c.req.json<{ email?: string; password?: string; name?: string }>();
  const email = body.email?.trim().toLowerCase() ?? '';
  const password = body.password ?? '';

  if (!EMAIL_RE.test(email)) {
    return c.json({ message: '请输入有效邮箱地址' }, 400);
  }
  if (password.length < 8) {
    return c.json({ message: '密码至少 8 位' }, 400);
  }

  try {
    const user = await registerEmailUser({ email, password, name: body.name });
    await issueSession(c, user);
    await writeAuditLog(c, { action: 'auth.register', resourceType: 'user', resourceId: user.id, user });
    return c.json({ ok: true, user });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Registration failed';
    if (msg === 'Email already registered') {
      return c.json({ message: '该邮箱已注册' }, 409);
    }
    console.error('[auth] register error:', err);
    return c.json({ message: '注册失败，请稍后重试' }, 500);
  }
});

authRoutes.post('/auth/login', async (c) => {
  if (!isEmailAuthEnabled()) {
    return c.json({ message: 'Email login is disabled' }, 403);
  }

  const body = await c.req.json<{ email?: string; password?: string }>();
  const email = body.email?.trim() ?? '';
  const password = body.password ?? '';

  if (!email || !password) {
    return c.json({ message: '请输入邮箱和密码' }, 400);
  }

  try {
    const user = await loginEmailUser(email, password);
    await issueSession(c, user);
    await writeAuditLog(c, { action: 'auth.login', resourceType: 'user', resourceId: user.id, user });
    return c.json({ ok: true, user });
  } catch {
    return c.json({ message: '邮箱或密码错误' }, 401);
  }
});

authRoutes.get('/auth/feishu/url', (c) => {
  if (!isFeishuLoginAvailable()) {
    return c.json({ message: 'Feishu OAuth is not configured' }, 503);
  }
  const state = randomBytes(16).toString('hex');
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    maxAge: 600,
    path: '/',
  });
  return c.json({ url: buildFeishuAuthorizeUrl(state) });
});

authRoutes.get('/auth/feishu/callback', async (c) => {
  if (!isFeishuLoginAvailable()) {
    return c.redirect('/login?error=feishu_not_configured');
  }

  const code = c.req.query('code');
  const state = c.req.query('state');
  const savedState = getCookie(c, 'oauth_state');

  if (!code || !state || state !== savedState) {
    return c.redirect('/login?error=invalid_oauth_state');
  }

  try {
    const feishuUser = await exchangeCodeForUser(code);
    const user = await findOrCreateFeishuUser(feishuUser);
    await issueSession(c, user);
    await writeAuditLog(c, { action: 'auth.feishu_login', resourceType: 'user', resourceId: user.id, user });
    deleteCookie(c, 'oauth_state', { path: '/' });
    return c.redirect('/');
  } catch (err) {
    console.error('[auth] Feishu callback error:', err);
    return c.redirect('/login?error=oauth_failed');
  }
});

authRoutes.post('/auth/logout', async (c) => {
  const user = await getCurrentUserOptional(c);
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  if (user) {
    await writeAuditLog(c, { action: 'auth.logout', resourceType: 'user', resourceId: user.id, user });
  }
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const user = await getCurrentUser(c);
  return c.json(user);
});
