import { eq, desc, asc, and } from 'drizzle-orm';
import { Hono } from 'hono';
import {
  db,
  users,
  fobSettlementBatches,
  fobServiceProviders,
  fobMerchantPaymentStatus,
  fobMerchantShipments,
  fobContainerMerchantStats,
  fobTruckingBillItems,
  fobFreightBillItems,
  fobSettlementAllocations,
  fobSettlementAdjustments,
  fobFeeAllocationRules,
  resetFobFeeRuleDisplayPriorities,
} from '@scm/db';
import { enrichContainerStats } from '../lib/fob-allocation-base-meta.js';
import { getCurrentUser } from '../lib/auth-context.js';
import {
  parseSenweiTruckingSheet,
  parseSimplifiedTruckingSheet,
  isSenweiTruckingSheet,
  isSimplifiedTruckingSheet,
  parseHuamaoFreightSheet,
  parseSimplifiedFreightSheet,
  isHuamaoFreightSheet,
  isSimplifiedFreightSheet,
  parseMerchantShipmentRows,
  parseEdVolumeSheet,
  isEdVolumeExport,
  parseVolumeSheetRows,
  sheetRowsFromBuffer,
} from '../lib/fob-bill-parsers.js';
import { rowsToObjects, parseDelimitedText } from '../lib/import/parse.js';
import {
  aggregateMerchantVolumes,
  allocateFees,
  padMissingMerchantAllocations,
  reconcileAllocations,
  shouldPadMerchantPlaceholders,
  summarizeByMerchant,
  mergeVolumeAndTicketStats,
  sortAllocationRows,
  type FeeLine,
  type AllocationRow,
} from '../lib/fob-settlement.js';
import {
  buildNoAllocationMessage,
  blocksCalculation,
  buildBillOnlyBlockMessage,
} from '../lib/fob-container-match.js';
import { statsByContainer } from '../lib/fob-container-stats.js';
import {
  EXCEPTION_REASON_LABEL,
  matchAllocationRule,
  type ExceptionReason,
} from '../lib/fob-fee-rules.js';
import {
  loadActiveFeeRules,
  rebuildContainerMerchantStats,
  resolveRuleForBillItem,
  countPendingExceptions,
  effectiveBillAmount,
  FOB_NON_FOB_MARKER,
  isNonFobMarkerShipment,
  computeMatchFromShipments,
  partitionVolumeShipments,
  nextFobBatchNo,
} from '../lib/fob-batch-helpers.js';
import { requireMenu } from '../lib/rbac.js';
import { assertRowCount, assertUploadFile } from '../lib/upload-guard.js';
import {
  buildFobImportTemplate,
  type FobTemplateType,
} from '../lib/fob-import-templates.js';
import {
  buildByMerchantZipFileName,
  buildMerchantBillWideExportAoa,
  buildMerchantExportFileName,
  buildTotalBillWideExportAoa,
  buildTotalExportFileName,
  buildXlsxBuffer,
  buildZipBuffer,
  contentDispositionAttachment,
  listMerchantsForExport,
  sanitizeExportFileName,
} from '../lib/fob-reconcile-export.js';
import { validatePaymentUpdate, type PaymentStatus } from '../lib/fob-payment-status.js';

const fobMenu = requireMenu('logistics.fob_settlement');

const FOB_TEMPLATE_TYPES = new Set<FobTemplateType>(['volume', 'trucking', 'freight']);

function mapAllocationRow(a: {
  id?: string;
  containerNo: string;
  merchantCode: string;
  merchantName: string | null;
  stage: AllocationRow['stage'];
  feeType: string;
  sourceBillType: string;
  sourceBillItemId: string | null;
  sourceRef: string | null;
  allocationMethod: AllocationRow['allocationMethod'];
  sourceAmountCny: string;
  merchantVolumeCbm: string;
  volumeRatio: string;
  ticketCount: number | null;
  ticketRatio: string | null;
  allocatedAmountCny: string;
  isTailAdjustment: boolean;
  isManualOverride?: boolean;
  overrideReason?: string | null;
}) {
  return {
    id: a.id,
    containerNo: a.containerNo,
    merchantCode: a.merchantCode,
    merchantName: a.merchantName,
    stage: a.stage,
    feeType: a.feeType,
    sourceBillType: a.sourceBillType,
    sourceBillItemId: a.sourceBillItemId,
    sourceRef: a.sourceRef,
    allocationMethod: a.allocationMethod,
    sourceAmountCny: a.sourceAmountCny,
    merchantVolumeCbm: a.merchantVolumeCbm,
    volumeRatio: a.volumeRatio,
    ticketCount: a.ticketCount,
    ticketRatio: a.ticketRatio,
    allocatedAmountCny: a.allocatedAmountCny,
    isTailAdjustment: a.isTailAdjustment,
    isManualOverride: a.isManualOverride ?? false,
    overrideReason: a.overrideReason ?? null,
  };
}

function mapAllocationRowForCalc(a: Parameters<typeof mapAllocationRow>[0]): AllocationRow {
  const row = mapAllocationRow(a);
  return {
    containerNo: row.containerNo,
    merchantCode: row.merchantCode,
    merchantName: row.merchantName,
    stage: row.stage,
    feeType: row.feeType,
    sourceBillType: row.sourceBillType as 'trucking' | 'freight',
    sourceBillItemId: row.sourceBillItemId ?? '',
    sourceRef: row.sourceRef ?? undefined,
    allocationMethod: row.allocationMethod,
    sourceAmountCny: Number(row.sourceAmountCny),
    merchantVolumeCbm: Number(row.merchantVolumeCbm),
    volumeRatio: Number(row.volumeRatio),
    ticketCount: row.ticketCount ?? undefined,
    ticketRatio: row.ticketRatio != null ? Number(row.ticketRatio) : undefined,
    allocatedAmountCny: Number(row.allocatedAmountCny),
    isTailAdjustment: row.isTailAdjustment,
    isManualOverride: row.isManualOverride,
    overrideReason: row.overrideReason,
  };
}

function inferTruckingStage(feeType: string): FeeLine['stage'] {
  if (/报关|关税|增值税|查验|清关/.test(feeType)) return 'customs';
  return 'trucking';
}

async function buildFeeLines(
  batchId: string,
  settlementType: 'trucking' | 'freight',
): Promise<FeeLine[]> {
  if (settlementType === 'trucking') {
    const trucking = await db
      .select()
      .from(fobTruckingBillItems)
      .where(eq(fobTruckingBillItems.batchId, batchId));
    return trucking.map((t) => ({
      key: t.id,
      containerNo: t.containerNo,
      stage: inferTruckingStage(t.feeType),
      feeType: t.feeType,
      sourceBillType: 'trucking' as const,
      sourceRef: t.internalNo ?? t.blNo ?? undefined,
      amountCny: effectiveBillAmount(
        Number(t.amountCny),
        t.adjustedAmountCny != null ? Number(t.adjustedAmountCny) : null,
      ),
      allocationMethod: t.allocationMethod ?? 'by_volume',
      assignedMerchantCode: t.assignedMerchantCode,
      isException: t.isException,
      exceptionStatus: t.exceptionStatus,
    }));
  }

  const freight = await db
    .select()
    .from(fobFreightBillItems)
    .where(eq(fobFreightBillItems.batchId, batchId));
  return freight.map((f) => ({
    key: f.id,
    containerNo: f.containerNo,
    stage: f.stage,
    feeType: f.feeType,
    sourceBillType: 'freight' as const,
    sourceRef: f.orderNo ?? f.blNo ?? undefined,
    amountCny: effectiveBillAmount(
      Number(f.amountCny),
      f.adjustedAmountCny != null ? Number(f.adjustedAmountCny) : null,
    ),
    allocationMethod: f.allocationMethod ?? 'by_volume',
    assignedMerchantCode: f.assignedMerchantCode,
    isException: f.isException,
    exceptionStatus: f.exceptionStatus,
  }));
}

async function buildMerchantStatsMap(batchId: string) {
  const [stats, shipments] = await Promise.all([
    db.select().from(fobContainerMerchantStats).where(eq(fobContainerMerchantStats.batchId, batchId)),
    db.select().from(fobMerchantShipments).where(eq(fobMerchantShipments.batchId, batchId)),
  ]);

  const volumeMap = aggregateMerchantVolumes(
    shipments.map((s) => ({
      merchantCode: s.merchantCode,
      merchantName: s.merchantName,
      containerNo: s.containerNo,
      volumeCbm: Number(s.volumeCbm),
    })),
  );

  const ticketMap = statsByContainer(
    stats.map((s) => ({
      merchantCode: s.merchantCode,
      merchantName: s.merchantName,
      containerNo: s.containerNo,
      volumeCbm: Number(s.volumeCbm),
      ticketCount: s.ticketCount,
    })),
  );

  return mergeVolumeAndTicketStats(volumeMap, ticketMap);
}

export const logisticsRoutes = new Hono();

logisticsRoutes.get('/logistics/fob-settlements/templates/:type', fobMenu, async (c) => {
  const type = c.req.param('type') as FobTemplateType;
  if (!FOB_TEMPLATE_TYPES.has(type)) {
    return c.json({ message: 'Invalid template type' }, 400);
  }
  const { buffer, filename } = await buildFobImportTemplate(type);
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
    },
  });
});

const fobBatchSelect = {
  id: fobSettlementBatches.id,
  batchNo: fobSettlementBatches.batchNo,
  name: fobSettlementBatches.name,
  settlementPeriod: fobSettlementBatches.settlementPeriod,
  settlementType: fobSettlementBatches.settlementType,
  serviceProviderId: fobSettlementBatches.serviceProviderId,
  usdToCnyRate: fobSettlementBatches.usdToCnyRate,
  status: fobSettlementBatches.status,
  remark: fobSettlementBatches.remark,
  createdBy: fobSettlementBatches.createdBy,
  createdAt: fobSettlementBatches.createdAt,
  updatedAt: fobSettlementBatches.updatedAt,
  createdByName: users.name,
  serviceProvider: {
    id: fobServiceProviders.id,
    code: fobServiceProviders.code,
    name: fobServiceProviders.name,
    providerType: fobServiceProviders.providerType,
  },
};

function mapFobBatchRow<T extends {
  id: string;
  batchNo: string;
  name: string;
  settlementPeriod: string;
  settlementType: 'trucking' | 'freight';
  serviceProviderId: string;
  usdToCnyRate: string;
  status: string;
  remark: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdByName: string | null;
  serviceProvider: {
    id: string | null;
    code: string | null;
    name: string | null;
    providerType: 'trucking' | 'freight' | null;
  };
}>(row: T) {
  const { serviceProvider, ...batch } = row;
  return {
    ...batch,
    serviceProvider:
      serviceProvider.id != null
        ? {
            id: serviceProvider.id,
            code: serviceProvider.code!,
            name: serviceProvider.name!,
            providerType: serviceProvider.providerType!,
          }
        : null,
  };
}

async function getBatchWithProvider(batchId: string) {
  const [row] = await db
    .select({
      batch: fobSettlementBatches,
      provider: fobServiceProviders,
    })
    .from(fobSettlementBatches)
    .innerJoin(
      fobServiceProviders,
      eq(fobSettlementBatches.serviceProviderId, fobServiceProviders.id),
    )
    .where(eq(fobSettlementBatches.id, batchId))
    .limit(1);
  if (!row) return null;
  return { ...row.batch, serviceProvider: row.provider };
}

async function mergeMerchantPaymentSummary<T extends { merchantCode: string }>(
  batchId: string,
  summary: T[],
) {
  const paymentRows = await db
    .select()
    .from(fobMerchantPaymentStatus)
    .where(eq(fobMerchantPaymentStatus.batchId, batchId));
  const paymentMap = new Map(paymentRows.map((p) => [p.merchantCode, p]));
  return summary.map((m) => {
    const payment = paymentMap.get(m.merchantCode);
    return {
      ...m,
      paymentStatus: (payment?.paymentStatus ?? 'unpaid') as PaymentStatus,
      paymentRemark: payment?.remark ?? null,
    };
  });
}

logisticsRoutes.get('/logistics/fob-settlements', async (c) => {
  const rows = await db
    .select(fobBatchSelect)
    .from(fobSettlementBatches)
    .leftJoin(users, eq(fobSettlementBatches.createdBy, users.id))
    .leftJoin(
      fobServiceProviders,
      eq(fobSettlementBatches.serviceProviderId, fobServiceProviders.id),
    )
    .orderBy(desc(fobSettlementBatches.createdAt))
    .limit(200);
  return c.json(rows.map((row) => mapFobBatchRow(row)));
});

logisticsRoutes.get('/logistics/fob-settlements/:id', async (c) => {
  const batchId = c.req.param('id');
  const [batchRow] = await db
    .select(fobBatchSelect)
    .from(fobSettlementBatches)
    .leftJoin(users, eq(fobSettlementBatches.createdBy, users.id))
    .leftJoin(
      fobServiceProviders,
      eq(fobSettlementBatches.serviceProviderId, fobServiceProviders.id),
    )
    .where(eq(fobSettlementBatches.id, batchId))
    .limit(1);
  if (!batchRow) return c.json({ message: 'Batch not found' }, 404);
  const batch = mapFobBatchRow(batchRow);

  await refreshBillItemExceptionFlags(batchId);
  await syncUnbalancedAllocationPlaceholders(batchId);

  const [merchantShipments, containerStats, truckingItems, freightItems, allocations] =
    await Promise.all([
      db.select().from(fobMerchantShipments).where(eq(fobMerchantShipments.batchId, batchId)),
      db.select().from(fobContainerMerchantStats).where(eq(fobContainerMerchantStats.batchId, batchId)),
      db.select().from(fobTruckingBillItems).where(eq(fobTruckingBillItems.batchId, batchId)),
      db.select().from(fobFreightBillItems).where(eq(fobFreightBillItems.batchId, batchId)),
      db.select().from(fobSettlementAllocations).where(eq(fobSettlementAllocations.batchId, batchId)),
    ]);

  const allocationRows = sortAllocationRows(allocations.map((a) => mapAllocationRow(a)));
  const allocationRowsForCalc = allocationRows.map((a) => mapAllocationRowForCalc(a));

  const pendingExceptions = await countPendingExceptions(batchId);

  const billContainerNos =
    batch.settlementType === 'trucking'
      ? truckingItems.map((t) => t.containerNo)
      : freightItems.map((f) => f.containerNo);
  const containerMatch = computeMatchFromShipments(merchantShipments, billContainerNos);
  const { nonFobContainers } = partitionVolumeShipments(merchantShipments);

  const fobShipmentRows = merchantShipments.filter(
    (s) => !isNonFobMarkerShipment(s.merchantCode),
  );

  const merchantSummary = await mergeMerchantPaymentSummary(
    batchId,
    summarizeByMerchant(allocationRowsForCalc),
  );

  return c.json({
    ...batch,
    merchantShipments: fobShipmentRows,
    nonFobContainers,
    containerStats: enrichContainerStats(containerStats, {
      settlementType: batch.settlementType,
      truckingItems,
      freightItems,
      merchantShipments: fobShipmentRows,
    }),
    truckingItems,
    freightItems,
    allocations: allocationRows,
    pendingExceptions,
    merchantSummary,
    containerMatch,
  });
});

logisticsRoutes.post('/logistics/fob-settlements', fobMenu, async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    name: string;
    settlementPeriod: string;
    settlementType: 'trucking' | 'freight';
    serviceProviderId: string;
    usdToCnyRate?: number;
    remark?: string;
  }>();

  if (!body.name?.trim() || !body.settlementPeriod?.trim()) {
    return c.json({ message: 'name and settlementPeriod required' }, 400);
  }
  if (body.settlementType !== 'trucking' && body.settlementType !== 'freight') {
    return c.json({ message: 'settlementType must be trucking or freight' }, 400);
  }
  if (!body.serviceProviderId?.trim()) {
    return c.json({ message: 'serviceProviderId required' }, 400);
  }

  const [provider] = await db
    .select()
    .from(fobServiceProviders)
    .where(eq(fobServiceProviders.id, body.serviceProviderId.trim()))
    .limit(1);
  if (!provider) return c.json({ message: '服务商不存在' }, 400);
  if (!provider.isActive) return c.json({ message: '服务商已停用' }, 400);
  if (provider.providerType !== body.settlementType) {
    return c.json({ message: '服务商类型与结算类型不匹配' }, 400);
  }

  const batchNo = await nextFobBatchNo();
  let batch;
  try {
    [batch] = await db
      .insert(fobSettlementBatches)
      .values({
        batchNo,
        name: body.name.trim(),
        settlementPeriod: body.settlementPeriod.trim(),
        settlementType: body.settlementType,
        serviceProviderId: provider.id,
        usdToCnyRate: String(body.usdToCnyRate ?? 7.25),
        remark: body.remark,
        status: 'draft',
        createdBy: user.id,
      })
      .returning();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === '23505') {
      return c.json({ message: '批次编号冲突，请重试' }, 409);
    }
    throw err;
  }

  return c.json(batch, 201);
});

async function getBatchOr404(batchId: string) {
  const [batch] = await db
    .select()
    .from(fobSettlementBatches)
    .where(eq(fobSettlementBatches.id, batchId))
    .limit(1);
  return batch ?? null;
}

function confirmedBatchResponse() {
  return { message: '批次已确认，不可再修改' };
}

function allocationInsertValues(batchId: string, row: AllocationRow) {
  return {
    batchId,
    containerNo: row.containerNo,
    merchantCode: row.merchantCode,
    merchantName: row.merchantName,
    stage: row.stage,
    feeType: row.feeType,
    sourceBillType: row.sourceBillType,
    sourceBillItemId: row.sourceBillItemId,
    sourceRef: row.sourceRef,
    allocationMethod: row.allocationMethod,
    sourceAmountCny: String(row.sourceAmountCny),
    merchantVolumeCbm: String(row.merchantVolumeCbm),
    volumeRatio: String(row.volumeRatio),
    ticketCount: row.ticketCount,
    ticketRatio: row.ticketRatio != null ? String(row.ticketRatio) : undefined,
    allocatedAmountCny: String(row.allocatedAmountCny),
    isTailAdjustment: row.isTailAdjustment,
  };
}

/** 未平账费用项补齐柜内各主体 ¥0 占位行（已有核算批次） */
async function syncUnbalancedAllocationPlaceholders(batchId: string): Promise<number> {
  const batch = await getBatchOr404(batchId);
  if (!batch || batch.status !== 'calculated') return 0;

  const [merchantStats, feeLines, allocations] = await Promise.all([
    buildMerchantStatsMap(batchId),
    buildFeeLines(batchId, batch.settlementType),
    db.select().from(fobSettlementAllocations).where(eq(fobSettlementAllocations.batchId, batchId)),
  ]);

  const byBillItem = new Map<string, typeof allocations>();
  for (const row of allocations) {
    if (!row.sourceBillItemId) continue;
    const list = byBillItem.get(row.sourceBillItemId) ?? [];
    list.push(row);
    byBillItem.set(row.sourceBillItemId, list);
  }

  let inserted = 0;
  for (const fee of feeLines) {
    if (fee.isException && (fee.exceptionStatus === 'pending' || fee.exceptionStatus === 'rejected')) {
      continue;
    }

    const merchants = merchantStats.get(fee.containerNo) ?? [];
    if (!merchants.length) continue;

    const existingDb = byBillItem.get(fee.key) ?? [];
    const existingRows = existingDb.map((a) => mapAllocationRowForCalc(a));
    if (!shouldPadMerchantPlaceholders(fee, existingRows)) continue;

    const padded = padMissingMerchantAllocations(merchants, fee, existingRows);
    const existingCodes = new Set(existingDb.map((r) => r.merchantCode));
    for (const row of padded) {
      if (existingCodes.has(row.merchantCode)) continue;
      await db.insert(fobSettlementAllocations).values(allocationInsertValues(batchId, row));
      inserted++;
    }
  }

  return inserted;
}

/** 按最新规则刷新未审核账单行的异常标记（已确认/驳回的不动） */
async function refreshBillItemExceptionFlags(batchId: string) {
  const batch = await getBatchOr404(batchId);
  if (!batch || batch.status === 'confirmed') return;

  const rules = await loadActiveFeeRules();
  const [trucking, freight] = await Promise.all([
    db.select().from(fobTruckingBillItems).where(eq(fobTruckingBillItems.batchId, batchId)),
    db.select().from(fobFreightBillItems).where(eq(fobFreightBillItems.batchId, batchId)),
  ]);

  for (const item of trucking) {
    if (item.exceptionStatus === 'confirmed' || item.exceptionStatus === 'rejected') continue;
    const resolved = resolveRuleForBillItem(
      rules,
      item.feeType,
      'trucking',
      item.remark,
      Number(item.amountCny),
      item.assignedMerchantCode,
    );
    await db
      .update(fobTruckingBillItems)
      .set({
        allocationMethod: resolved.allocationMethod,
        isException: resolved.isException,
        exceptionStatus: resolved.isException ? 'pending' : null,
      })
      .where(eq(fobTruckingBillItems.id, item.id));
  }

  for (const item of freight) {
    if (item.exceptionStatus === 'confirmed' || item.exceptionStatus === 'rejected') continue;
    const resolved = resolveRuleForBillItem(
      rules,
      item.feeType,
      'freight',
      item.remark,
      Number(item.amountCny),
      item.assignedMerchantCode,
    );
    await db
      .update(fobFreightBillItems)
      .set({
        allocationMethod: resolved.allocationMethod,
        isException: resolved.isException,
        exceptionStatus: resolved.isException ? 'pending' : null,
        stage: resolved.stage,
      })
      .where(eq(fobFreightBillItems.id, item.id));
  }
}

function resolveItemExceptionReason(
  feeType: string,
  billType: 'trucking' | 'freight',
  rules: Awaited<ReturnType<typeof loadActiveFeeRules>>,
  remark?: string | null,
  amountCny?: number,
): ExceptionReason | undefined {
  return matchAllocationRule(feeType, billType, rules, remark, amountCny).exceptionReason;
}

async function buildBatchReconcile(batchId: string) {
  const batch = await getBatchOr404(batchId);
  if (!batch) {
    return reconcileAllocations([], [], 0);
  }
  await syncUnbalancedAllocationPlaceholders(batchId);
  const [feeLines, allocations, pendingExceptions] = await Promise.all([
    buildFeeLines(batchId, batch.settlementType),
    db.select().from(fobSettlementAllocations).where(eq(fobSettlementAllocations.batchId, batchId)),
    countPendingExceptions(batchId),
  ]);
  return reconcileAllocations(
    feeLines,
    sortAllocationRows(allocations.map((a) => mapAllocationRow(a))).map((a) =>
      mapAllocationRowForCalc(a),
    ),
    pendingExceptions,
  );
}

logisticsRoutes.post('/logistics/fob-settlements/:id/import/trucking', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const batch = await getBatchWithProvider(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);
  if (batch.status === 'confirmed') return c.json(confirmedBatchResponse(), 400);
  if (batch.settlementType !== 'trucking') {
    return c.json({ message: '该批次为货代结算，请使用货代账单导入' }, 400);
  }

  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || !(file instanceof File)) return c.json({ message: 'file required' }, 400);
  try {
    assertUploadFile(file);
  } catch (err) {
    return c.json({ message: err instanceof Error ? err.message : 'Invalid file' }, 400);
  }

  const rows = await sheetRowsFromBuffer(await file.arrayBuffer());
  try {
    assertRowCount(rows);
  } catch (err) {
    return c.json({ message: err instanceof Error ? err.message : 'Too many rows' }, 400);
  }
  const warnings: string[] = [];

  const parsed = isSenweiTruckingSheet(rows)
    ? parseSenweiTruckingSheet(rows)
    : isSimplifiedTruckingSheet(rows)
      ? parseSimplifiedTruckingSheet(rows)
      : parseSenweiTruckingSheet(rows);
  if (!parsed.items.length) {
    return c.json({ message: '未解析到拖车费用行', errors: parsed.errors, warnings }, 400);
  }

  const rules = await loadActiveFeeRules();
  await db.delete(fobTruckingBillItems).where(eq(fobTruckingBillItems.batchId, batchId));

  let exceptionCount = 0;
  for (const item of parsed.items) {
    const resolved = resolveRuleForBillItem(
      rules,
      item.feeType,
      'trucking',
      item.remark,
      item.amountCny,
      item.assignedMerchantCode,
    );
    if (item.forceException) {
      resolved.isException = true;
      resolved.exceptionStatus = 'pending';
      resolved.allocationMethod = 'manual';
    }
    if (resolved.isException) exceptionCount++;

    await db.insert(fobTruckingBillItems).values({
      batchId,
      containerNo: item.containerNo,
      internalNo: item.internalNo,
      blNo: item.blNo,
      shipDate: item.shipDate,
      loadAddress: item.loadAddress,
      feeType: item.feeType,
      amountCny: String(item.amountCny),
      sourceRow: item.sourceRow,
      remark: item.remark,
      allocationMethod: resolved.allocationMethod,
      isException: resolved.isException,
      exceptionStatus: resolved.exceptionStatus,
      assignedMerchantCode: resolved.assignedMerchantCode,
      adjustedAmountCny: String(item.amountCny),
    });
  }

  await db
    .update(fobSettlementBatches)
    .set({ status: 'imported', updatedAt: new Date() })
    .where(eq(fobSettlementBatches.id, batchId));

  return c.json({
    imported: parsed.items.length,
    containers: new Set(parsed.items.map((i) => i.containerNo)).size,
    skippedRows: parsed.skippedRows,
    exceptionCount,
    errors: parsed.errors,
    warnings,
  });
});

logisticsRoutes.post('/logistics/fob-settlements/:id/import/freight', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const batch = await getBatchWithProvider(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);
  if (batch.status === 'confirmed') return c.json(confirmedBatchResponse(), 400);
  if (batch.settlementType !== 'freight') {
    return c.json({ message: '该批次为拖车结算，请使用拖车账单导入' }, 400);
  }

  const form = await c.req.formData();
  const file = form.get('file');
  if (!file || !(file instanceof File)) return c.json({ message: 'file required' }, 400);
  try {
    assertUploadFile(file);
  } catch (err) {
    return c.json({ message: err instanceof Error ? err.message : 'Invalid file' }, 400);
  }

  const rows = await sheetRowsFromBuffer(await file.arrayBuffer());
  try {
    assertRowCount(rows);
  } catch (err) {
    return c.json({ message: err instanceof Error ? err.message : 'Too many rows' }, 400);
  }
  const warnings: string[] = [];

  const parsed = isHuamaoFreightSheet(rows)
    ? parseHuamaoFreightSheet(rows)
    : isSimplifiedFreightSheet(rows)
      ? parseSimplifiedFreightSheet(rows)
      : parseHuamaoFreightSheet(rows);
  if (!parsed.items.length) {
    return c.json({ message: '未解析到货运费用行', errors: parsed.errors, warnings }, 400);
  }

  const rules = await loadActiveFeeRules();
  await db.delete(fobFreightBillItems).where(eq(fobFreightBillItems.batchId, batchId));

  let exceptionCount = 0;
  for (const item of parsed.items) {
    const resolved = resolveRuleForBillItem(
      rules,
      item.feeType,
      'freight',
      item.remark,
      item.amountCny,
      item.assignedMerchantCode,
    );
    if (item.forceException) {
      resolved.isException = true;
      resolved.exceptionStatus = 'pending';
      resolved.allocationMethod = 'manual';
    }
    if (resolved.isException) exceptionCount++;

    await db.insert(fobFreightBillItems).values({
      batchId,
      containerNo: item.containerNo,
      orderNo: item.orderNo,
      blNo: item.blNo,
      bizDate: item.bizDate,
      destPort: item.destPort,
      volumeCbm: item.volumeCbm != null ? String(item.volumeCbm) : undefined,
      feeType: item.feeType,
      stage: item.forceException ? 'other' : resolved.stage,
      amountCny: String(item.amountCny),
      originalCurrency: item.originalCurrency,
      originalAmount: String(item.originalAmount),
      exchangeRate: item.exchangeRate != null ? String(item.exchangeRate) : undefined,
      sourceRow: item.sourceRow,
      panelSide: item.panelSide,
      remark: item.remark,
      allocationMethod: resolved.allocationMethod,
      isException: resolved.isException,
      exceptionStatus: resolved.exceptionStatus,
      assignedMerchantCode: resolved.assignedMerchantCode,
      adjustedAmountCny: String(item.amountCny),
    });
  }

  await db
    .update(fobSettlementBatches)
    .set({ status: 'imported', updatedAt: new Date() })
    .where(eq(fobSettlementBatches.id, batchId));

  return c.json({
    imported: parsed.items.length,
    containers: new Set(parsed.items.map((i) => i.containerNo)).size,
    skippedRows: parsed.skippedRows,
    exceptionCount,
    errors: parsed.errors,
    warnings,
  });
});

logisticsRoutes.post('/logistics/fob-settlements/:id/import/shipments', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const batch = await getBatchOr404(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);
  if (batch.status === 'confirmed') return c.json(confirmedBatchResponse(), 400);

  const contentType = c.req.header('content-type') ?? '';
  let parsed: Awaited<ReturnType<typeof parseEdVolumeSheet>> = {
    items: [],
    errors: [],
    skippedRows: 0,
  };

  if (contentType.includes('multipart/form-data')) {
    const form = await c.req.formData();
    const file = form.get('file');
    if (!file || !(file instanceof File)) return c.json({ message: 'file required' }, 400);
    try {
      assertUploadFile(file);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Invalid file' }, 400);
    }
    const buffer = await file.arrayBuffer();
    const name = file.name.toLowerCase();
    if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
      const rows = await sheetRowsFromBuffer(buffer);
      if (rows.length < 2) return c.json({ message: '表格为空' }, 400);
      try {
        assertRowCount(rows);
      } catch (err) {
        return c.json({ message: err instanceof Error ? err.message : 'Too many rows' }, 400);
      }
      parsed = parseVolumeSheetRows(rows);
    } else {
      const objects = rowsToObjects(parseDelimitedText(new TextDecoder().decode(buffer)));
      try {
        assertRowCount(objects);
      } catch (err) {
        return c.json({ message: err instanceof Error ? err.message : 'Too many rows' }, 400);
      }
      parsed = parseMerchantShipmentRows(objects);
    }
  } else {
    const body = await c.req.json<{ csv?: string }>();
    if (!body.csv?.trim()) return c.json({ message: 'csv required' }, 400);
    const objects = rowsToObjects(parseDelimitedText(body.csv));
    try {
      assertRowCount(objects);
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Too many rows' }, 400);
    }
    parsed = parseMerchantShipmentRows(objects);
  }

  const nonFobContainers = parsed.nonFobContainers ?? [];
  if (!parsed.items.length && !nonFobContainers.length) {
    return c.json({ message: '未解析到体积信息行', errors: parsed.errors }, 400);
  }

  await db.delete(fobMerchantShipments).where(eq(fobMerchantShipments.batchId, batchId));

  let sortOrder = 0;
  for (const item of parsed.items) {
    await db.insert(fobMerchantShipments).values({
      batchId,
      merchantCode: item.merchantCode,
      merchantName: item.merchantName,
      containerNo: item.containerNo,
      skuCode: item.skuCode,
      qty: item.qty,
      volumeCbm: String(item.volumeCbm),
      weightKg: item.weightKg != null ? String(item.weightKg) : undefined,
      remark: item.remark,
      sortOrder: sortOrder++,
    });
  }

  for (const containerNo of nonFobContainers) {
    await db.insert(fobMerchantShipments).values({
      batchId,
      merchantCode: FOB_NON_FOB_MARKER,
      merchantName: '非FOB',
      containerNo,
      volumeCbm: '0',
      remark: '非FOB，不参与分账',
      sortOrder: sortOrder++,
    });
  }

  const stats = await rebuildContainerMerchantStats(batchId);

  await db
    .update(fobSettlementBatches)
    .set({ status: 'imported', updatedAt: new Date() })
    .where(eq(fobSettlementBatches.id, batchId));

  const merchants = new Set(parsed.items.map((i) => i.merchantCode)).size;
  return c.json({
    imported: parsed.items.length,
    containers: new Set(parsed.items.map((i) => i.containerNo)).size,
    nonFobContainers,
    merchants,
    ticketStats: stats.length,
    skippedRows: parsed.skippedRows,
    errors: parsed.errors,
  });
});

logisticsRoutes.get('/logistics/fob-settlements/:id/exceptions', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const batch = await getBatchOr404(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);

  await refreshBillItemExceptionFlags(batchId);

  const rules = await loadActiveFeeRules();
  const [trucking, freight] = await Promise.all([
    db.select().from(fobTruckingBillItems).where(eq(fobTruckingBillItems.batchId, batchId)),
    db.select().from(fobFreightBillItems).where(eq(fobFreightBillItems.batchId, batchId)),
  ]);

  const mapExceptionItem = <
    T extends {
      id: string;
      containerNo: string;
      feeType: string;
      amountCny: string;
      adjustedAmountCny: string | null;
      allocationMethod: string | null;
      assignedMerchantCode: string | null;
      exceptionStatus: string | null;
      reviewNote: string | null;
      remark: string | null;
    },
  >(
    row: T,
    billType: 'trucking' | 'freight',
  ) => {
    const reason = resolveItemExceptionReason(
      row.feeType,
      billType,
      rules,
      row.remark,
      Number(row.amountCny),
    );
    return {
      id: row.id,
      billType,
      containerNo: row.containerNo,
      feeType: row.feeType,
      amountCny: Number(row.amountCny),
      adjustedAmountCny:
        row.adjustedAmountCny != null ? Number(row.adjustedAmountCny) : Number(row.amountCny),
      allocationMethod: row.allocationMethod,
      assignedMerchantCode: row.assignedMerchantCode,
      exceptionStatus: row.exceptionStatus,
      exceptionReason: reason,
      exceptionReasonLabel: reason ? EXCEPTION_REASON_LABEL[reason] : undefined,
      reviewNote: row.reviewNote,
      remark: row.remark,
    };
  };

  const items = [
    ...trucking.filter((t) => t.isException).map((t) => mapExceptionItem(t, 'trucking')),
    ...freight.filter((f) => f.isException).map((f) => mapExceptionItem(f, 'freight')),
  ];

  return c.json({ items, pendingCount: items.filter((i) => i.exceptionStatus === 'pending').length });
});

logisticsRoutes.patch('/logistics/fob-settlements/:id/exceptions/:itemId', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const itemId = c.req.param('itemId');
  const batch = await getBatchOr404(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);
  if (batch.status === 'confirmed') return c.json(confirmedBatchResponse(), 400);

  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    billType: 'trucking' | 'freight';
    exceptionStatus?: 'pending' | 'confirmed' | 'rejected';
    assignedMerchantCode?: string;
    adjustedAmountCny?: number;
    allocationMethod?: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
    reviewNote?: string;
  }>();

  if (!body.billType) return c.json({ message: 'billType required' }, 400);

  const table = body.billType === 'trucking' ? fobTruckingBillItems : fobFreightBillItems;
  const [existing] = await db
    .select()
    .from(table)
    .where(and(eq(table.id, itemId), eq(table.batchId, batchId)))
    .limit(1);
  if (!existing) return c.json({ message: 'Item not found' }, 404);

  const resolvedMethod = body.allocationMethod ?? existing.allocationMethod ?? 'manual';
  if (body.exceptionStatus === 'confirmed' && resolvedMethod === 'manual') {
    const merchant = (body.assignedMerchantCode ?? existing.assignedMerchantCode)?.trim();
    if (!merchant) {
      return c.json({ message: '人工分摊须指定归属工厂/主体' }, 400);
    }
  }

  const patch = {
    ...(body.exceptionStatus ? { exceptionStatus: body.exceptionStatus } : {}),
    ...(body.assignedMerchantCode != null ? { assignedMerchantCode: body.assignedMerchantCode.trim() } : {}),
    ...(body.adjustedAmountCny != null ? { adjustedAmountCny: String(body.adjustedAmountCny) } : {}),
    ...(body.allocationMethod ? { allocationMethod: body.allocationMethod } : {}),
    ...(body.reviewNote != null ? { reviewNote: body.reviewNote } : {}),
    reviewedBy: user.id,
    reviewedAt: new Date(),
    ...(body.exceptionStatus === 'confirmed' ? { isException: false } : {}),
    ...(body.exceptionStatus === 'rejected' ? { isException: true } : {}),
  };

  if (body.billType === 'trucking') {
    const [row] = await db
      .update(fobTruckingBillItems)
      .set(patch)
      .where(and(eq(fobTruckingBillItems.id, itemId), eq(fobTruckingBillItems.batchId, batchId)))
      .returning();
    if (!row) return c.json({ message: 'Item not found' }, 404);
    return c.json(row);
  }

  const [row] = await db
    .update(fobFreightBillItems)
    .set(patch)
    .where(and(eq(fobFreightBillItems.id, itemId), eq(fobFreightBillItems.batchId, batchId)))
    .returning();
  if (!row) return c.json({ message: 'Item not found' }, 404);
  return c.json(row);
});

logisticsRoutes.patch('/logistics/fob-settlements/:id/container-stats/:statId', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const statId = c.req.param('statId');
  const batch = await getBatchOr404(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);
  if (batch.status === 'confirmed') return c.json(confirmedBatchResponse(), 400);

  const body = await c.req.json<{ ticketCount?: number }>();
  if (body.ticketCount == null || body.ticketCount < 0 || body.ticketCount > 1) {
    return c.json({ message: 'ticketCount 须为 0 或 1（同一货柜内每工厂/主体最多 1 票）' }, 400);
  }

  const [row] = await db
    .update(fobContainerMerchantStats)
    .set({ ticketCount: body.ticketCount, updatedAt: new Date() })
    .where(and(eq(fobContainerMerchantStats.id, statId), eq(fobContainerMerchantStats.batchId, batchId)))
    .returning();

  if (!row) return c.json({ message: 'Stat not found' }, 404);
  return c.json(row);
});

logisticsRoutes.post('/logistics/fob-settlements/:id/calculate', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const batch = await getBatchOr404(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);
  if (batch.status === 'confirmed') return c.json(confirmedBatchResponse(), 400);

  const pendingExceptions = await countPendingExceptions(batchId);
  if (pendingExceptions > 0) {
    return c.json(
      { message: `仍有 ${pendingExceptions} 条异常费用待审核，请先处理后再核算`, pendingExceptions },
      400,
    );
  }

  const [shipments, trucking, freight] = await Promise.all([
    db.select().from(fobMerchantShipments).where(eq(fobMerchantShipments.batchId, batchId)),
    db.select().from(fobTruckingBillItems).where(eq(fobTruckingBillItems.batchId, batchId)),
    db.select().from(fobFreightBillItems).where(eq(fobFreightBillItems.batchId, batchId)),
  ]);

  const fobShipments = shipments.filter((s) => !isNonFobMarkerShipment(s.merchantCode));
  if (!fobShipments.length) {
    return c.json({ message: '请先导入含 FOB 的体积信息（货柜内需至少一行 FOB）' }, 400);
  }
  if (batch.settlementType === 'trucking' && !trucking.length) {
    return c.json({ message: '请先导入拖车账单' }, 400);
  }
  if (batch.settlementType === 'freight' && !freight.length) {
    return c.json({ message: '请先导入货代账单' }, 400);
  }

  const billContainerNos =
    batch.settlementType === 'trucking'
      ? trucking.map((t) => t.containerNo)
      : freight.map((f) => f.containerNo);
  const containerMatch = computeMatchFromShipments(shipments, billContainerNos);

  if (blocksCalculation(containerMatch)) {
    return c.json(
      {
        message: buildBillOnlyBlockMessage(containerMatch),
        containerMatch,
      },
      400,
    );
  }

  const merchantStats = await buildMerchantStatsMap(batchId);
  const feeLines = await buildFeeLines(batchId, batch.settlementType);
  const { allocations, warnings } = allocateFees(merchantStats, feeLines);

  if (!allocations.length) {
    return c.json(
      {
        message: buildNoAllocationMessage(containerMatch),
        warnings,
        containerMatch,
      },
      400,
    );
  }

  const reconcile = reconcileAllocations(feeLines, allocations, pendingExceptions);

  await db.delete(fobSettlementAllocations).where(eq(fobSettlementAllocations.batchId, batchId));

  for (const row of allocations) {
    await db.insert(fobSettlementAllocations).values(allocationInsertValues(batchId, row));
  }

  await db
    .update(fobSettlementBatches)
    .set({ status: 'calculated', updatedAt: new Date() })
    .where(eq(fobSettlementBatches.id, batchId));

  const merchantSummary = summarizeByMerchant(allocations);
  for (const m of merchantSummary) {
    await db
      .insert(fobMerchantPaymentStatus)
      .values({
        batchId,
        merchantCode: m.merchantCode,
        paymentStatus: 'unpaid',
      })
      .onConflictDoUpdate({
        target: [fobMerchantPaymentStatus.batchId, fobMerchantPaymentStatus.merchantCode],
        set: { updatedAt: new Date() },
      });
  }

  return c.json({
    allocationCount: allocations.length,
    merchantSummary: await mergeMerchantPaymentSummary(batchId, merchantSummary),
    warnings,
    reconcile,
  });
});

logisticsRoutes.get('/logistics/fob-settlements/:id/reconcile', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const batch = await getBatchOr404(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);

  await syncUnbalancedAllocationPlaceholders(batchId);

  const [feeLines, allocations, pendingExceptions] = await Promise.all([
    buildFeeLines(batchId, batch.settlementType),
    db.select().from(fobSettlementAllocations).where(eq(fobSettlementAllocations.batchId, batchId)),
    countPendingExceptions(batchId),
  ]);

  const allocationRows = sortAllocationRows(allocations.map((a) => mapAllocationRow(a)));
  const reconcile = reconcileAllocations(
    feeLines,
    allocationRows.map((a) => mapAllocationRowForCalc(a)),
    pendingExceptions,
  );
  return c.json(reconcile);
});

logisticsRoutes.post('/logistics/fob-settlements/:id/adjustments', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const user = await getCurrentUser(c);
  const batch = await getBatchOr404(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);
  if (batch.status === 'confirmed') return c.json(confirmedBatchResponse(), 400);

  const body = await c.req.json<{
    allocationId: string;
    adjustType: 'amount' | 'merchant' | 'exclude';
    adjustedValue: string;
    reason?: string;
  }>();

  const [allocation] = await db
    .select()
    .from(fobSettlementAllocations)
    .where(and(eq(fobSettlementAllocations.id, body.allocationId), eq(fobSettlementAllocations.batchId, batchId)))
    .limit(1);

  if (!allocation) return c.json({ message: 'Allocation not found' }, 404);

  if (body.adjustType === 'exclude') {
    await db.delete(fobSettlementAllocations).where(eq(fobSettlementAllocations.id, body.allocationId));
  } else if (body.adjustType === 'amount') {
    await db
      .update(fobSettlementAllocations)
      .set({
        allocatedAmountCny: body.adjustedValue,
        allocationMethod: 'manual',
        isManualOverride: true,
        overrideReason: body.reason ?? '人工调账',
      })
      .where(eq(fobSettlementAllocations.id, body.allocationId));
  } else if (body.adjustType === 'merchant') {
    await db
      .update(fobSettlementAllocations)
      .set({
        merchantCode: body.adjustedValue,
        allocationMethod: 'manual',
        isManualOverride: true,
        overrideReason: body.reason ?? '人工调整承担工厂/主体',
      })
      .where(eq(fobSettlementAllocations.id, body.allocationId));
  }

  await db.insert(fobSettlementAdjustments).values({
    batchId,
    allocationId: body.allocationId,
    adjustType: body.adjustType,
    originalValue:
      body.adjustType === 'amount'
        ? allocation.allocatedAmountCny
        : body.adjustType === 'merchant'
          ? allocation.merchantCode
          : allocation.id,
    adjustedValue: body.adjustedValue,
    reason: body.reason,
    createdBy: user.id,
  });

  const [feeLines, allocations, pendingExceptions] = await Promise.all([
    buildFeeLines(batchId, batch.settlementType),
    db.select().from(fobSettlementAllocations).where(eq(fobSettlementAllocations.batchId, batchId)),
    countPendingExceptions(batchId),
  ]);

  const reconcile = reconcileAllocations(
    feeLines,
    sortAllocationRows(allocations.map((a) => mapAllocationRow(a))).map((a) => mapAllocationRowForCalc(a)),
    pendingExceptions,
  );

  return c.json({ ok: true, reconcile });
});

logisticsRoutes.patch('/logistics/fob-settlements/:id/merchant-payments', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const batch = await getBatchOr404(batchId);
  if (!batch) return c.json({ message: 'Batch not found' }, 404);

  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    updates: Array<{
      merchantCode: string;
      paymentStatus: PaymentStatus;
      remark?: string;
    }>;
  }>();

  if (!Array.isArray(body.updates) || !body.updates.length) {
    return c.json({ message: 'updates required' }, 400);
  }

  for (const update of body.updates) {
    const merchantCode = update.merchantCode?.trim();
    if (!merchantCode) return c.json({ message: 'merchantCode required' }, 400);
    if (
      update.paymentStatus !== 'paid' &&
      update.paymentStatus !== 'unpaid' &&
      update.paymentStatus !== 'not_required'
    ) {
      return c.json({ message: 'invalid paymentStatus' }, 400);
    }
    try {
      validatePaymentUpdate({
        paymentStatus: update.paymentStatus,
        remark: update.remark,
      });
    } catch (err) {
      return c.json({ message: err instanceof Error ? err.message : 'Invalid payment update' }, 400);
    }

    await db
      .insert(fobMerchantPaymentStatus)
      .values({
        batchId,
        merchantCode,
        paymentStatus: update.paymentStatus,
        remark: update.remark?.trim() || null,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: [fobMerchantPaymentStatus.batchId, fobMerchantPaymentStatus.merchantCode],
        set: {
          paymentStatus: update.paymentStatus,
          remark: update.remark?.trim() || null,
          updatedBy: user.id,
          updatedAt: new Date(),
        },
      });
  }

  return c.json({ ok: true, updated: body.updates.length });
});

logisticsRoutes.patch('/logistics/fob-settlements/:id', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const existing = await getBatchOr404(batchId);
  if (!existing) return c.json({ message: 'Batch not found' }, 404);
  if (existing.status === 'confirmed') return c.json(confirmedBatchResponse(), 400);

  const body = await c.req.json<{
    name?: string;
    usdToCnyRate?: number;
    status?: 'draft' | 'imported' | 'reviewed' | 'calculated' | 'confirmed';
    remark?: string;
  }>();

  if (body.status === 'confirmed') {
    const pending = await countPendingExceptions(batchId);
    if (pending > 0) {
      return c.json(
        { message: `仍有 ${pending} 条异常费用待审核，无法确认批次`, pendingExceptions: pending },
        400,
      );
    }
    const reconcile = await buildBatchReconcile(batchId);
    if (!reconcile.balanced) {
      return c.json(
        {
          message: '未平账，无法确认批次',
          reconcile,
        },
        400,
      );
    }
  }

  const [batch] = await db
    .update(fobSettlementBatches)
    .set({
      ...(body.name != null ? { name: body.name.trim() } : {}),
      ...(body.usdToCnyRate != null ? { usdToCnyRate: String(body.usdToCnyRate) } : {}),
      ...(body.status ? { status: body.status } : {}),
      ...(body.remark != null ? { remark: body.remark } : {}),
      updatedAt: new Date(),
    })
    .where(eq(fobSettlementBatches.id, batchId))
    .returning();

  if (!batch) return c.json({ message: 'Batch not found' }, 404);
  return c.json(batch);
});

logisticsRoutes.delete('/logistics/fob-settlements/:id', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const existing = await getBatchOr404(batchId);
  if (!existing) return c.json({ message: 'Batch not found' }, 404);
  if (existing.status === 'confirmed') {
    return c.json({ message: '批次已确认，不可删除' }, 400);
  }

  await db.delete(fobSettlementBatches).where(eq(fobSettlementBatches.id, batchId));
  return c.json({ ok: true });
});

logisticsRoutes.get('/logistics/fob-service-providers', fobMenu, async (c) => {
  const providerType = c.req.query('providerType');
  const activeOnly = c.req.query('activeOnly') === 'true';

  const conditions = [];
  if (providerType === 'trucking' || providerType === 'freight') {
    conditions.push(eq(fobServiceProviders.providerType, providerType));
  }
  if (activeOnly) {
    conditions.push(eq(fobServiceProviders.isActive, true));
  }

  const rows = await db
    .select()
    .from(fobServiceProviders)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(fobServiceProviders.sortOrder), asc(fobServiceProviders.name));

  return c.json(rows);
});

logisticsRoutes.post('/logistics/fob-service-providers', fobMenu, async (c) => {
  const body = await c.req.json<{
    code: string;
    name: string;
    providerType: 'trucking' | 'freight';
    sortOrder?: number;
    remark?: string;
    isActive?: boolean;
  }>();

  const code = body.code?.trim();
  const name = body.name?.trim();
  if (!code || !name) return c.json({ message: 'code and name required' }, 400);
  if (body.providerType !== 'trucking' && body.providerType !== 'freight') {
    return c.json({ message: 'providerType must be trucking or freight' }, 400);
  }

  const [row] = await db
    .insert(fobServiceProviders)
    .values({
      code,
      name,
      providerType: body.providerType,
      sortOrder: body.sortOrder ?? 0,
      remark: body.remark?.trim() || null,
      isActive: body.isActive ?? true,
      updatedAt: new Date(),
    })
    .returning();

  return c.json(row, 201);
});

logisticsRoutes.patch('/logistics/fob-service-providers/:id', fobMenu, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    providerType?: 'trucking' | 'freight';
    sortOrder?: number;
    remark?: string | null;
    isActive?: boolean;
  }>();

  const [existing] = await db
    .select()
    .from(fobServiceProviders)
    .where(eq(fobServiceProviders.id, id))
    .limit(1);
  if (!existing) return c.json({ message: 'Provider not found' }, 404);

  if (body.providerType != null && body.providerType !== 'trucking' && body.providerType !== 'freight') {
    return c.json({ message: 'invalid providerType' }, 400);
  }

  const [row] = await db
    .update(fobServiceProviders)
    .set({
      ...(body.name != null ? { name: body.name.trim() } : {}),
      ...(body.providerType ? { providerType: body.providerType } : {}),
      ...(body.sortOrder != null ? { sortOrder: body.sortOrder } : {}),
      ...(body.remark !== undefined ? { remark: body.remark?.trim() || null } : {}),
      ...(body.isActive != null ? { isActive: body.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(fobServiceProviders.id, id))
    .returning();

  if (!row) return c.json({ message: 'Provider not found' }, 404);
  return c.json(row);
});

logisticsRoutes.patch('/logistics/fob-service-providers/:id/toggle', fobMenu, async (c) => {
  const id = c.req.param('id');
  const [existing] = await db
    .select()
    .from(fobServiceProviders)
    .where(eq(fobServiceProviders.id, id))
    .limit(1);
  if (!existing) return c.json({ message: 'Provider not found' }, 404);

  const [row] = await db
    .update(fobServiceProviders)
    .set({ isActive: !existing.isActive, updatedAt: new Date() })
    .where(eq(fobServiceProviders.id, id))
    .returning();

  if (!row) return c.json({ message: 'Provider not found' }, 404);
  return c.json(row);
});

logisticsRoutes.get('/logistics/fob-fee-rules', fobMenu, async (c) => {
  const sourceBillType = c.req.query('sourceBillType');
  const rows = await db
    .select()
    .from(fobFeeAllocationRules)
    .orderBy(
      fobFeeAllocationRules.sourceBillType,
      desc(fobFeeAllocationRules.priority),
      fobFeeAllocationRules.feeType,
    );
  const filtered =
    sourceBillType === 'trucking' || sourceBillType === 'freight'
      ? rows.filter((r) => r.sourceBillType === sourceBillType)
      : rows;
  return c.json(filtered);
});

logisticsRoutes.post('/logistics/fob-fee-rules/reset-priorities', fobMenu, async (c) => {
  const result = await resetFobFeeRuleDisplayPriorities();
  return c.json({ ok: true, ...result });
});

logisticsRoutes.post('/logistics/fob-fee-rules', fobMenu, async (c) => {
  const body = await c.req.json<{
    feeType?: string;
    sourceBillType: 'trucking' | 'freight';
    matchPattern?: string;
    allocationMethod: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
    defaultStage?: 'trucking' | 'freight' | 'customs' | 'other';
    priority?: number;
    remark?: string;
    isActive?: boolean;
  }>();

  const feeType = body.feeType?.trim() || null;
  const matchPattern = body.matchPattern?.trim() || null;
  if (!feeType && !matchPattern) {
    return c.json({ message: 'feeType 与 matchPattern 至少填一项' }, 400);
  }
  if (!body.sourceBillType || !body.allocationMethod) {
    return c.json({ message: 'sourceBillType and allocationMethod required' }, 400);
  }
  if (body.allocationMethod === 'fixed') {
    return c.json({ message: '全局规则不支持固定分摊，请使用需确认或在批次异常审核中指定归属' }, 400);
  }

  const [row] = await db
    .insert(fobFeeAllocationRules)
    .values({
      feeType,
      sourceBillType: body.sourceBillType,
      matchPattern,
      allocationMethod: body.allocationMethod,
      defaultStage: body.defaultStage ?? 'other',
      priority: body.priority ?? 10,
      remark: body.remark?.trim() || null,
      isActive: body.isActive ?? true,
    })
    .returning();

  return c.json(row, 201);
});

logisticsRoutes.patch('/logistics/fob-fee-rules/:id', fobMenu, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    feeType?: string | null;
    matchPattern?: string | null;
    allocationMethod?: 'by_volume' | 'by_ticket' | 'fixed' | 'manual';
    defaultStage?: 'trucking' | 'freight' | 'customs' | 'other';
    priority?: number;
    remark?: string | null;
    isActive?: boolean;
  }>();

  const [existing] = await db
    .select()
    .from(fobFeeAllocationRules)
    .where(eq(fobFeeAllocationRules.id, id))
    .limit(1);
  if (!existing) return c.json({ message: 'Rule not found' }, 404);

  const feeType = body.feeType !== undefined ? body.feeType?.trim() || null : existing.feeType;
  const matchPattern =
    body.matchPattern !== undefined ? body.matchPattern?.trim() || null : existing.matchPattern;
  if (!feeType && !matchPattern) {
    return c.json({ message: 'feeType 与 matchPattern 至少保留一项' }, 400);
  }
  if (body.allocationMethod === 'fixed') {
    return c.json({ message: '全局规则不支持固定分摊，请使用需确认或在批次异常审核中指定归属' }, 400);
  }

  const [row] = await db
    .update(fobFeeAllocationRules)
    .set({
      ...(body.feeType !== undefined ? { feeType } : {}),
      ...(body.matchPattern !== undefined ? { matchPattern } : {}),
      ...(body.allocationMethod ? { allocationMethod: body.allocationMethod } : {}),
      ...(body.defaultStage ? { defaultStage: body.defaultStage } : {}),
      ...(body.priority != null ? { priority: body.priority } : {}),
      ...(body.remark !== undefined ? { remark: body.remark?.trim() || null } : {}),
      ...(body.isActive != null ? { isActive: body.isActive } : {}),
    })
    .where(eq(fobFeeAllocationRules.id, id))
    .returning();

  if (!row) return c.json({ message: 'Rule not found' }, 404);
  return c.json(row);
});

async function loadReconcileExportData(batchId: string) {
  const batch = await getBatchWithProvider(batchId);
  if (!batch) return null;
  const provider = batch.serviceProvider;
  if (!provider) return null;

  const [allocationRows, feeRules, paymentRows, truckingItems, freightItems, containerStats] =
    await Promise.all([
      db
        .select()
        .from(fobSettlementAllocations)
        .where(eq(fobSettlementAllocations.batchId, batchId)),
      loadActiveFeeRules(),
      db
        .select()
        .from(fobMerchantPaymentStatus)
        .where(eq(fobMerchantPaymentStatus.batchId, batchId)),
      db.select().from(fobTruckingBillItems).where(eq(fobTruckingBillItems.batchId, batchId)),
      db.select().from(fobFreightBillItems).where(eq(fobFreightBillItems.batchId, batchId)),
      db
        .select()
        .from(fobContainerMerchantStats)
        .where(eq(fobContainerMerchantStats.batchId, batchId)),
    ]);

  const allocations = sortAllocationRows(allocationRows.map((a) => mapAllocationRowForCalc(a)));
  const paymentByMerchant = new Map(
    paymentRows.map((p) => [
      p.merchantCode,
      {
        paymentStatus: p.paymentStatus as 'paid' | 'unpaid' | 'not_required',
        remark: p.remark,
      },
    ]),
  );

  return {
    batch,
    provider,
    allocations,
    feeRules,
    paymentByMerchant,
    truckingItems,
    freightItems,
    containerStats,
  };
}

logisticsRoutes.get('/logistics/fob-settlements/:id/export/reconcile-total', fobMenu, async (c) => {
  const batchId = c.req.param('id');
  const payload = await loadReconcileExportData(batchId);
  if (!payload) return c.json({ message: 'Batch not found' }, 404);
  if (!payload.allocations.length) {
    return c.json({ message: '暂无分摊数据，请先执行分摊核算' }, 400);
  }

  const rows = buildTotalBillWideExportAoa({
    settlementType: payload.batch.settlementType,
    allocations: payload.allocations,
    providerName: payload.provider.name,
    truckingItems: payload.truckingItems,
    freightItems: payload.freightItems,
    containerStats: payload.containerStats,
  });
  const buffer = await buildXlsxBuffer(rows, '分摊总账');
  const filename = buildTotalExportFileName(payload.batch.batchNo, payload.batch.settlementPeriod);

  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': contentDispositionAttachment(filename),
    },
  });
});

logisticsRoutes.get(
  '/logistics/fob-settlements/:id/export/reconcile-by-merchant',
  fobMenu,
  async (c) => {
    const batchId = c.req.param('id');
    const payload = await loadReconcileExportData(batchId);
    if (!payload) return c.json({ message: 'Batch not found' }, 404);
    if (!payload.allocations.length) {
      return c.json({ message: '暂无分摊数据，请先执行分摊核算' }, 400);
    }

    const merchants = listMerchantsForExport(payload.allocations);
    const usedNames = new Set<string>();
    const files: Array<{ name: string; buffer: Buffer }> = [];

    for (const merchant of merchants) {
      const rows = buildMerchantBillWideExportAoa({
        settlementType: payload.batch.settlementType,
        allocations: payload.allocations,
        merchantCode: merchant.merchantCode,
        providerName: payload.provider.name,
        truckingItems: payload.truckingItems,
        freightItems: payload.freightItems,
        containerStats: payload.containerStats,
      });
      const buffer = await buildXlsxBuffer(rows, '分摊平账');
      let filename = buildMerchantExportFileName(
        merchant.merchantName,
        merchant.merchantCode,
        payload.batch.settlementPeriod,
      );
      if (usedNames.has(filename)) {
        filename = `${sanitizeExportFileName(merchant.merchantName ?? merchant.merchantCode)}_${sanitizeExportFileName(merchant.merchantCode)}_${sanitizeExportFileName(payload.batch.settlementPeriod)}.xlsx`;
      }
      usedNames.add(filename);
      files.push({ name: filename, buffer });
    }

    const zipBuffer = await buildZipBuffer(files);
    const zipName = buildByMerchantZipFileName(
      payload.batch.batchNo,
      payload.batch.settlementPeriod,
    );

    return new Response(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': contentDispositionAttachment(zipName),
      },
    });
  },
);
