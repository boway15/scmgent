import { eq, desc, and, inArray, or, ilike, sql } from 'drizzle-orm';
import { parseListPagination } from '../lib/list-pagination.js';
import { Hono } from 'hono';
import { db, purchaseDrafts, skus, pmcPlans, users } from '@scm/db';
import { analysisOnlyResponse } from '../lib/analysis-only.js';
import { requireMenu } from '../lib/rbac.js';
import {
  normalizePurchaseDraftStatus,
  PURCHASE_DRAFT_STATUS_LABEL,
} from '../lib/purchase-draft-lifecycle.js';

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
  etaAvailable: string | null;
  confirmedDeliveryDate: string | null;
  plannedProductionDoneDate: string | null;
  actualProductionDoneDate: string | null;
  plannedPickupDate: string | null;
  etd: string | null;
  etaPort: string | null;
  customsDoneDate: string | null;
  etaWarehouse: string | null;
  transportMode: string | null;
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
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const status = c.req.query('status')?.trim();
  const q = c.req.query('q')?.trim();
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
      etaAvailable: purchaseDrafts.etaAvailable,
      confirmedDeliveryDate: purchaseDrafts.confirmedDeliveryDate,
      plannedProductionDoneDate: purchaseDrafts.plannedProductionDoneDate,
      actualProductionDoneDate: purchaseDrafts.actualProductionDoneDate,
      plannedPickupDate: purchaseDrafts.plannedPickupDate,
      etd: purchaseDrafts.etd,
      etaPort: purchaseDrafts.etaPort,
      customsDoneDate: purchaseDrafts.customsDoneDate,
      etaWarehouse: purchaseDrafts.etaWarehouse,
      transportMode: purchaseDrafts.transportMode,
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
  if (q) {
    const pattern = `%${q}%`;
    conditions.push(
      or(
        ilike(purchaseDrafts.draftNo, pattern),
        ilike(skus.code, pattern),
        ilike(skus.name, pattern),
        ilike(pmcPlans.planNo, pattern),
        ilike(pmcPlans.merchantCode, pattern),
        ilike(pmcPlans.merchantName, pattern),
      )!,
    );
  }

  const where = and(...conditions);

  const [rows, countRow] = await Promise.all([
    baseQuery.where(where).orderBy(desc(purchaseDrafts.createdAt)).limit(pageSize).offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(purchaseDrafts)
      .innerJoin(skus, eq(skus.id, purchaseDrafts.skuId))
      .leftJoin(pmcPlans, eq(pmcPlans.id, purchaseDrafts.sourceRefId))
      .where(where),
  ]);

  return c.json({
    items: rows.map(mapDraftRow),
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
});

procurementRoutes.post('/purchase-drafts', async (c) => analysisOnlyResponse(c));

procurementRoutes.patch('/purchase-drafts/:id', requireMenu('pmc.tracking'), async (c) =>
  analysisOnlyResponse(c),
);

procurementRoutes.post('/purchase-drafts/:id/receive', requireMenu('pmc.tracking'), async (c) =>
  analysisOnlyResponse(c),
);

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
