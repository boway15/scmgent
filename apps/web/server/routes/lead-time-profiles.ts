import { and, desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, leadTimeProfiles } from '@scm/db';
import { requireMenu } from '../lib/rbac.js';

const TRANSPORT_MODES = ['fcl', 'lcl', 'air', 'express', 'rail', 'truck_air', 'direct'] as const;
type TransportMode = (typeof TRANSPORT_MODES)[number];

type LeadTimeProfileInput = {
  merchantCode?: unknown;
  originLocation?: unknown;
  destinationWarehouseCode?: unknown;
  transportMode?: unknown;
  productionDays?: unknown;
  domesticDays?: unknown;
  bookingDays?: unknown;
  transitDays?: unknown;
  customsDays?: unknown;
  inboundDays?: unknown;
  leadTimeStdDev?: unknown;
  isDefault?: unknown;
  sourceSystem?: unknown;
  externalId?: unknown;
};

type ParsedLeadTimeProfile = {
  merchantCode: string | null;
  originLocation: string | null;
  destinationWarehouseCode: string;
  transportMode: TransportMode | null;
  productionDays: number;
  domesticDays: number;
  bookingDays: number;
  transitDays: number;
  customsDays: number;
  inboundDays: number;
  leadTimeStdDev: number | null;
  isDefault: boolean;
  sourceSystem: string | null;
  externalId: string | null;
};

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

export function parseLeadTimeProfileInput(
  body: LeadTimeProfileInput,
): { ok: true; value: ParsedLeadTimeProfile } | { ok: false; message: string } {
  const destinationWarehouseCode = optionalText(body.destinationWarehouseCode);
  if (!destinationWarehouseCode) {
    return { ok: false, message: 'destinationWarehouseCode is required' };
  }

  const transportMode = optionalText(body.transportMode);
  if (transportMode && !TRANSPORT_MODES.includes(transportMode as TransportMode)) {
    return { ok: false, message: 'transportMode is invalid' };
  }

  const dayFields = [
    'productionDays',
    'domesticDays',
    'bookingDays',
    'transitDays',
    'customsDays',
    'inboundDays',
  ] as const;
  const days: Record<(typeof dayFields)[number], number> = {
    productionDays: 0,
    domesticDays: 0,
    bookingDays: 0,
    transitDays: 0,
    customsDays: 0,
    inboundDays: 0,
  };
  for (const field of dayFields) {
    const value = body[field] ?? 0;
    if (!Number.isInteger(value) || (value as number) < 0) {
      return { ok: false, message: `${field} must be a non-negative integer` };
    }
    days[field] = value as number;
  }

  const leadTimeStdDev = body.leadTimeStdDev ?? null;
  if (
    leadTimeStdDev !== null &&
    (!Number.isInteger(leadTimeStdDev) || (leadTimeStdDev as number) < 0)
  ) {
    return { ok: false, message: 'leadTimeStdDev must be a non-negative integer' };
  }

  return {
    ok: true,
    value: {
      merchantCode: optionalText(body.merchantCode),
      originLocation: optionalText(body.originLocation),
      destinationWarehouseCode,
      transportMode: transportMode as TransportMode | null,
      ...days,
      leadTimeStdDev: leadTimeStdDev as number | null,
      isDefault: body.isDefault === true,
      sourceSystem: optionalText(body.sourceSystem),
      externalId: optionalText(body.externalId),
    },
  };
}

export const leadTimeProfileRoutes = new Hono();
const leadTimeMenu = requireMenu('inventory.lead_time');

leadTimeProfileRoutes.get('/lead-time-profiles', leadTimeMenu, async (c) => {
  const warehouse = c.req.query('warehouse')?.trim();
  const merchant = c.req.query('merchant')?.trim();
  const conditions = [];
  if (warehouse) conditions.push(eq(leadTimeProfiles.destinationWarehouseCode, warehouse));
  if (merchant) conditions.push(eq(leadTimeProfiles.merchantCode, merchant));

  const items = await db
    .select()
    .from(leadTimeProfiles)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(leadTimeProfiles.updatedAt), leadTimeProfiles.destinationWarehouseCode);
  return c.json({ items });
});

leadTimeProfileRoutes.post('/lead-time-profiles', leadTimeMenu, async (c) => {
  const body = await c.req.json<LeadTimeProfileInput & { id?: string }>();
  const parsed = parseLeadTimeProfileInput(body);
  if (!parsed.ok) return c.json({ message: parsed.message }, 400);

  const now = new Date();
  const profileId = body.id;
  if (profileId) {
    const [row] = await db
      .update(leadTimeProfiles)
      .set({ ...parsed.value, updatedAt: now })
      .where(eq(leadTimeProfiles.id, profileId))
      .returning();
    if (!row) return c.json({ message: 'Lead-time profile not found' }, 404);
    return c.json(row);
  }

  const [row] = await db
    .insert(leadTimeProfiles)
    .values({ ...parsed.value, updatedAt: now })
    .returning();
  return c.json(row, 201);
});

leadTimeProfileRoutes.delete('/lead-time-profiles/:id', leadTimeMenu, async (c) => {
  const profileId = c.req.param('id');
  if (!profileId) return c.json({ message: 'id is required' }, 400);
  const [row] = await db
    .delete(leadTimeProfiles)
    .where(eq(leadTimeProfiles.id, profileId))
    .returning({ id: leadTimeProfiles.id });
  if (!row) return c.json({ message: 'Lead-time profile not found' }, 404);
  return c.json({ ok: true });
});
