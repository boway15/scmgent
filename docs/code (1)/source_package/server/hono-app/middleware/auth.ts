import type { Context, Next } from 'hono';
import { isFeishuAuthEnabled } from '../integrations/feishu-auth';
import { getCurrentUserOptional } from '../lib/auth-context';
import { isRbacEnforced } from '../lib/rbac';

const PUBLIC_PREFIXES = [
  '/api/health',
  '/api/auth/',
];

export async function authMiddleware(c: Context, next: Next) {
  const path = c.req.path;

  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) {
    return next();
  }

  if (!isFeishuAuthEnabled()) {
    if (isRbacEnforced()) {
      const user = await getCurrentUserOptional(c);
      if (user) c.set('user', user);
    }
    return next();
  }

  const user = await getCurrentUserOptional(c);
  if (!user) {
    return c.json({ message: 'Unauthorized' }, 401);
  }

  c.set('user', user);
  return next();
}

export async function requireSuperAdmin(c: Context, next: Next) {
  const user = await getCurrentUserOptional(c);
  if (!user) return c.json({ message: 'Unauthorized' }, 401);
  if (user.role.code !== 'super_admin') {
    return c.json({ message: 'Forbidden' }, 403);
  }
  c.set('user', user);
  return next();
}
