import { db, shipmentMilestones, shipments } from '@scm/db';
import { desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { calcMilestoneDelayDays } from '../lib/shipment-delay.js';
import { requireMenu } from '../lib/rbac.js';

const SHIPMENT_STATUSES = [
  'booked',
  'loaded',
  'departed',
  'arrived_port',
  'customs',
  'received_wh',
  'available',
  'cancelled',
] as const;
const MILESTONES = SHIPMENT_STATUSES.filter((status) => status !== 'cancelled');
const shipmentMenu = requireMenu('pmc.shipments');

type ShipmentInput = {
  shipmentNo?: unknown;
  draftId?: unknown;
  planItemId?: unknown;
  skuId?: unknown;
  qty?: unknown;
  containerNo?: unknown;
  bookingRef?: unknown;
  trackingNo?: unknown;
  transportMode?: unknown;
  status?: unknown;
  etaAvailable?: unknown;
  sourceSystem?: unknown;
  externalId?: unknown;
};

type MilestoneInput = {
  milestone?: unknown;
  plannedAt?: unknown;
  actualAt?: unknown;
  remark?: unknown;
};

function optionalText(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() || null : null;
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function parseCreateInput(body: ShipmentInput) {
  const shipmentNo = optionalText(body.shipmentNo);
  const skuId = optionalText(body.skuId);
  if (!shipmentNo) return { ok: false as const, message: 'shipmentNo is required' };
  if (!skuId) return { ok: false as const, message: 'skuId is required' };
  if (!Number.isInteger(body.qty) || (body.qty as number) <= 0) {
    return { ok: false as const, message: 'qty must be a positive integer' };
  }
  if (
    body.status !== undefined &&
    !SHIPMENT_STATUSES.includes(body.status as (typeof SHIPMENT_STATUSES)[number])
  ) {
    return { ok: false as const, message: 'status is invalid' };
  }
  if (body.etaAvailable != null && !isDateOnly(body.etaAvailable)) {
    return { ok: false as const, message: 'etaAvailable must be YYYY-MM-DD' };
  }

  return {
    ok: true as const,
    value: {
      shipmentNo,
      draftId: optionalText(body.draftId),
      planItemId: optionalText(body.planItemId),
      skuId,
      qty: body.qty as number,
      containerNo: optionalText(body.containerNo),
      bookingRef: optionalText(body.bookingRef),
      trackingNo: optionalText(body.trackingNo),
      transportMode: optionalText(body.transportMode),
      status: (body.status as string | undefined) ?? 'booked',
      etaAvailable: optionalText(body.etaAvailable),
      sourceSystem: optionalText(body.sourceSystem),
      externalId: optionalText(body.externalId),
    },
  };
}

function parsePatchInput(body: ShipmentInput) {
  const patch: Record<string, string | number | null | Date> = {};
  const textFields = [
    'shipmentNo',
    'draftId',
    'planItemId',
    'skuId',
    'containerNo',
    'bookingRef',
    'trackingNo',
    'transportMode',
    'sourceSystem',
    'externalId',
  ] as const;
  for (const field of textFields) {
    if (body[field] !== undefined) patch[field] = optionalText(body[field]);
  }
  if (patch.shipmentNo === null) return { ok: false as const, message: 'shipmentNo is required' };
  if (patch.skuId === null) return { ok: false as const, message: 'skuId is required' };
  if (body.qty !== undefined) {
    if (!Number.isInteger(body.qty) || (body.qty as number) <= 0) {
      return { ok: false as const, message: 'qty must be a positive integer' };
    }
    patch.qty = body.qty as number;
  }
  if (body.status !== undefined) {
    if (!SHIPMENT_STATUSES.includes(body.status as (typeof SHIPMENT_STATUSES)[number])) {
      return { ok: false as const, message: 'status is invalid' };
    }
    patch.status = body.status as string;
  }
  if (body.etaAvailable !== undefined) {
    if (body.etaAvailable !== null && !isDateOnly(body.etaAvailable)) {
      return { ok: false as const, message: 'etaAvailable must be YYYY-MM-DD' };
    }
    patch.etaAvailable = body.etaAvailable as string | null;
  }
  patch.updatedAt = new Date();
  return { ok: true as const, value: patch };
}

async function listShipments() {
  const shipmentRows = await db.select().from(shipments).orderBy(desc(shipments.createdAt));
  if (shipmentRows.length === 0) return [];

  const milestoneRows = await db
    .select()
    .from(shipmentMilestones)
    .where(inArray(shipmentMilestones.shipmentId, shipmentRows.map((row) => row.id)));
  const today = new Date();
  const byShipment = new Map<string, typeof milestoneRows>();
  for (const milestone of milestoneRows) {
    const rows = byShipment.get(milestone.shipmentId) ?? [];
    rows.push(milestone);
    byShipment.set(milestone.shipmentId, rows);
  }

  return shipmentRows.map((shipment) => {
    const milestonesWithDelay = (byShipment.get(shipment.id) ?? []).map((milestone) => ({
      ...milestone,
      delayDays: calcMilestoneDelayDays(milestone.plannedAt, milestone.actualAt, today),
    }));
    const milestoneDelayDays = Math.max(
      0,
      ...milestonesWithDelay.map((milestone) => milestone.delayDays ?? 0),
    );
    const etaDelayDays =
      shipment.etaAvailable && shipment.status !== 'available' && shipment.status !== 'cancelled'
        ? (calcMilestoneDelayDays(shipment.etaAvailable, null, today) ?? 0)
        : 0;
    return {
      ...shipment,
      milestones: milestonesWithDelay,
      delayDays: Math.max(milestoneDelayDays, etaDelayDays),
    };
  });
}

export const shipmentRoutes = new Hono();

shipmentRoutes.get('/shipments', shipmentMenu, async (c) => {
  const items = await listShipments();
  return c.json({
    items: c.req.query('delayed') === '1' ? items.filter((item) => item.delayDays > 0) : items,
  });
});

shipmentRoutes.get('/shipments/delays', shipmentMenu, async (c) => {
  const items = (await listShipments()).filter((item) => item.delayDays > 0);
  return c.json({ items, total: items.length });
});

shipmentRoutes.post('/shipments', shipmentMenu, async (c) => {
  const parsed = parseCreateInput(await c.req.json<ShipmentInput>());
  if (!parsed.ok) return c.json({ message: parsed.message }, 400);
  const [row] = await db.insert(shipments).values(parsed.value).returning();
  return c.json(row, 201);
});

shipmentRoutes.patch('/shipments/:id', shipmentMenu, async (c) => {
  const shipmentId = c.req.param('id');
  if (!shipmentId) return c.json({ message: 'id is required' }, 400);
  const parsed = parsePatchInput(await c.req.json<ShipmentInput>());
  if (!parsed.ok) return c.json({ message: parsed.message }, 400);
  const [row] = await db
    .update(shipments)
    .set(parsed.value)
    .where(eq(shipments.id, shipmentId))
    .returning();
  if (!row) return c.json({ message: 'Shipment not found' }, 404);
  return c.json(row);
});

shipmentRoutes.post('/shipments/:id/milestones', shipmentMenu, async (c) => {
  const shipmentId = c.req.param('id');
  if (!shipmentId) return c.json({ message: 'id is required' }, 400);
  const body = await c.req.json<MilestoneInput>();
  if (!MILESTONES.includes(body.milestone as (typeof MILESTONES)[number])) {
    return c.json({ message: 'milestone is invalid' }, 400);
  }
  if (body.plannedAt != null && !isDateOnly(body.plannedAt)) {
    return c.json({ message: 'plannedAt must be YYYY-MM-DD' }, 400);
  }
  if (body.actualAt != null && !isDateOnly(body.actualAt)) {
    return c.json({ message: 'actualAt must be YYYY-MM-DD' }, 400);
  }

  const [shipment] = await db
    .select({ id: shipments.id })
    .from(shipments)
    .where(eq(shipments.id, shipmentId))
    .limit(1);
  if (!shipment) return c.json({ message: 'Shipment not found' }, 404);

  const values = {
    shipmentId,
    milestone: body.milestone as string,
    plannedAt: optionalText(body.plannedAt),
    actualAt: optionalText(body.actualAt),
    remark: optionalText(body.remark),
  };
  const [row] = await db
    .insert(shipmentMilestones)
    .values(values)
    .onConflictDoUpdate({
      target: [shipmentMilestones.shipmentId, shipmentMilestones.milestone],
      set: {
        plannedAt: values.plannedAt,
        actualAt: values.actualAt,
        remark: values.remark,
      },
    })
    .returning();
  return c.json({
    ...row,
    delayDays: calcMilestoneDelayDays(row.plannedAt, row.actualAt, new Date()),
  });
});
