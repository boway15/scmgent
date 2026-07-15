import { eq, desc, and, inArray, like } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, purchaseDrafts, skus, pmcPlans, users } from '@scm/db';
import { requireMenu } from '../lib/rbac.js';
import { getCurrentUser } from '../lib/auth-context.js';
import {
  assertPurchaseDraftTransition,
  normalizePurchaseDraftStatus,
  PURCHASE_DRAFT_STATUS_LABEL,
  type PurchaseDraftStatus,
} from '../lib/purchase-draft-lifecycle.js';
import { receivePurchaseDraft } from '../lib/purchase-draft-receipt.js';

function draftNo(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `PO-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${Date.now().toString().slice(-6)}`;
}

export async function createPurchaseDraft(params: {
  skuId: string;
  qty: number;
  expectedDate?: string;
  source: 'reorder' | 'pmc' | 'manual';
  sourceRefId?: string;
  planItemId?: string;
  remark?: string;
  createdBy: string;
}) {
  const [row] = await db
    .insert(purchaseDrafts)
    .values({
      draftNo: draftNo(),
      skuId: params.skuId,
      qty: params.qty,
      expectedDate: params.expectedDate,
      source: params.source,
      sourceRefId: params.sourceRefId,
      planItemId: params.planItemId,
      remark: params.remark,
      createdBy: params.createdBy,
      status: 'draft',
      receivedQty: 0,
    })
    .returning();
  return row;
}

export const procurementRoutes = new Hono();

const TRACKING_STATUSES: PurchaseDraftStatus[] = [
  'draft',
  'confirmed',
  'in_production',
  'ready_to_ship',
  'in_transit',
  'partial_received',
  'received',
  'exception',
  'cancelled',
];

function mapDraftRow(row: {
  id: string;
  draftNo: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  qty: number;
  expectedDate: string | null;
  source: string;
  sourceRefId: string | null;
  planItemId: string | null;
  planId: string | null;
  planNo: string | null;
  merchantCode: string | null;
  merchantName: string | null;
  status: string;
  supplierConfirmedAt: Date | null;
  confirmedDeliveryDate: string | null;
  actualShipDate: string | null;
  actualReceivedDate: string | null;
  receivedQty: number;
  exceptionReason: string | null;
  ownerUserId: string | null;
  ownerName: string | null;
  remark: string | null;
  createdAt: Date;
}) {
  const status = normalizePurchaseDraftStatus(row.status);
  return {
    ...row,
    status,
    statusLabel: PURCHASE_DRAFT_STATUS_LABEL[status],
    remainingQty: Math.max(row.qty - (row.receivedQty ?? 0), 0),
  };
}

procurementRoutes.get('/purchase-drafts', async (c) => {
  const status = c.req.query('status');
  const baseQuery = db
    .select({
      id: purchaseDrafts.id,
      draftNo: purchaseDrafts.draftNo,
      skuId: purchaseDrafts.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      qty: purchaseDrafts.qty,
      expectedDate: purchaseDrafts.expectedDate,
      source: purchaseDrafts.source,
      sourceRefId: purchaseDrafts.sourceRefId,
      planItemId: purchaseDrafts.planItemId,
      planId: purchaseDrafts.sourceRefId,
      planNo: pmcPlans.planNo,
      merchantCode: pmcPlans.merchantCode,
      merchantName: pmcPlans.merchantName,
      status: purchaseDrafts.status,
      supplierConfirmedAt: purchaseDrafts.supplierConfirmedAt,
      confirmedDeliveryDate: purchaseDrafts.confirmedDeliveryDate,
      actualShipDate: purchaseDrafts.actualShipDate,
      actualReceivedDate: purchaseDrafts.actualReceivedDate,
      receivedQty: purchaseDrafts.receivedQty,
      exceptionReason: purchaseDrafts.exceptionReason,
      ownerUserId: purchaseDrafts.ownerUserId,
      ownerName: users.name,
      remark: purchaseDrafts.remark,
      createdAt: purchaseDrafts.createdAt,
    })
    .from(purchaseDrafts)
    .innerJoin(skus, eq(skus.id, purchaseDrafts.skuId))
    .leftJoin(pmcPlans, eq(pmcPlans.id, purchaseDrafts.sourceRefId))
    .leftJoin(users, eq(users.id, purchaseDrafts.ownerUserId))
    .$dynamic();

  const conditions = [eq(purchaseDrafts.source, 'pmc')];
  if (status && TRACKING_STATUSES.includes(status as PurchaseDraftStatus)) {
    if (status === 'confirmed') {
      conditions.push(inArray(purchaseDrafts.status, ['confirmed', 'submitted']));
    } else {
      conditions.push(eq(purchaseDrafts.status, status as PurchaseDraftStatus));
    }
  }

  const rows = await baseQuery
    .where(and(...conditions))
    .orderBy(desc(purchaseDrafts.createdAt))
    .limit(200);

  return c.json(rows.map(mapDraftRow));
});

procurementRoutes.post('/purchase-drafts', async (c) => {
  return c.json({ message: '采购跟单仅由计划确认后自动生成' }, 403);
});

procurementRoutes.patch('/purchase-drafts/:id', requireMenu('pmc.tracking'), async (c) => {
  const user = await getCurrentUser(c);
  const draftId = c.req.param('id');
  const body = await c.req.json<{
    status?: PurchaseDraftStatus;
    remark?: string;
    confirmedDeliveryDate?: string;
    actualShipDate?: string;
    exceptionReason?: string;
    ownerUserId?: string;
  }>();

  const [existing] = await db
    .select()
    .from(purchaseDrafts)
    .where(eq(purchaseDrafts.id, draftId))
    .limit(1);
  if (!existing) return c.json({ message: 'Draft not found' }, 404);

  const currentStatus = normalizePurchaseDraftStatus(existing.status);
  const nextStatus = body.status ? normalizePurchaseDraftStatus(body.status) : undefined;

  if (nextStatus) {
    assertPurchaseDraftTransition(currentStatus, nextStatus);
  }

  const patch: Partial<typeof purchaseDrafts.$inferInsert> = {
    updatedAt: new Date(),
  };

  if (nextStatus) patch.status = nextStatus;
  if (body.remark != null) patch.remark = body.remark;
  if (body.confirmedDeliveryDate) patch.confirmedDeliveryDate = body.confirmedDeliveryDate;
  if (body.actualShipDate) patch.actualShipDate = body.actualShipDate;
  if (body.exceptionReason != null) patch.exceptionReason = body.exceptionReason;
  if (body.ownerUserId) patch.ownerUserId = body.ownerUserId;

  if (nextStatus === 'confirmed' && !existing.supplierConfirmedAt) {
    patch.supplierConfirmedAt = new Date();
    if (!body.confirmedDeliveryDate && existing.expectedDate) {
      patch.confirmedDeliveryDate = existing.expectedDate;
    }
  }

  if (!existing.ownerUserId) {
    patch.ownerUserId = user.id;
  }

  const [row] = await db
    .update(purchaseDrafts)
    .set(patch)
    .where(eq(purchaseDrafts.id, draftId))
    .returning();

  return c.json(row);
});

procurementRoutes.post('/purchase-drafts/:id/receive', requireMenu('pmc.tracking'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    qtyReceived: number;
    receivedDate?: string;
    idempotencyKey?: string;
  }>();

  try {
    const result = await receivePurchaseDraft({
      draftId: c.req.param('id'),
      qtyReceived: body.qtyReceived,
      receivedDate: body.receivedDate,
      idempotencyKey: body.idempotencyKey,
      userId: user.id,
    });
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Receive failed';
    return c.json({ message }, 400);
  }
});

/** Next plan number sequence */
export async function nextPlanNo(): Promise<string> {
  const d = new Date();
  const prefix = `PMC-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const rows = await db
    .select({ planNo: pmcPlans.planNo })
    .from(pmcPlans)
    .where(like(pmcPlans.planNo, `${prefix}%`));
  const seq = rows.length + 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}
