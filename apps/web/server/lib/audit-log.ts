import type { Context } from 'hono';
import { db, auditLogs } from '@scm/db';
import { getCurrentUserOptional } from './auth-context.js';

export type AuditLogInput = {
  action: string;
  resourceType?: string;
  resourceId?: string;
  detail?: string | Record<string, unknown>;
  user?: { id: string; name: string; email: string } | null;
};

function serializeDetail(detail?: string | Record<string, unknown>): string | null {
  if (detail == null) return null;
  if (typeof detail === 'string') return detail;
  return JSON.stringify(detail);
}

function requestIp(c: Context): string | null {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return c.req.header('x-real-ip') ?? null;
}

export async function writeAuditLog(c: Context | null, input: AuditLogInput): Promise<void> {
  try {
    let user = input.user ?? null;
    if (!user && c) {
      const authUser = await getCurrentUserOptional(c);
      if (authUser) user = authUser;
    }

    await db.insert(auditLogs).values({
      userId: user?.id ?? null,
      userName: user?.name ?? null,
      userEmail: user?.email ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      detail: serializeDetail(input.detail),
      ipAddress: c ? requestIp(c) : null,
      userAgent: c?.req.header('user-agent')?.slice(0, 500) ?? null,
    });
  } catch (err) {
    console.error('[audit] failed to write log:', err);
  }
}
