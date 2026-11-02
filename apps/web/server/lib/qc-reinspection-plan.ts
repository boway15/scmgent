export type QcSourceSnapshot = {
  recordId: string;
  factoryName: string;
  supplierShortName: string;
  inspectionStatus: string;
  purchaseOrderNo: string;
  demandNo: string;
  sku: string;
  productName: string;
  cartonCount: string;
  pieceCount: string;
  destWarehouse: string;
  factoryType: string;
  expectedShipDate: string;
  containerCartonCount: string;
  containerPieceCount: string;
  transferOrderNo: string;
  transferStatus: string;
  followUpReadyAtMs: number | null;
  goodsReadyAtMs: number | null;
  loadingNote: string;
  gapDays: number | null;
};

export function formatShanghaiDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ms));
}

export function selectNewReinspectionSourceIds(input: {
  source: Array<{ recordId: string; factoryName: string }>;
  whitelist: string[];
  existingSourceIds: string[];
}): string[] {
  const allowed = new Set(input.whitelist.map((name) => name.trim()).filter(Boolean));
  const existing = new Set(input.existingSourceIds);
  const ids: string[] = [];
  for (const row of input.source) {
    const factoryName = row.factoryName.trim();
    if (!factoryName || !allowed.has(factoryName) || existing.has(row.recordId)) continue;
    ids.push(row.recordId);
  }
  return ids;
}

export type ReinspectionIdentity = {
  purchaseOrderNo: string;
  sku: string;
  demandNo: string;
  transferOrderNo: string;
};

/** 采购单号 + SKU + 需求单号 + 调拨单号。空值和首尾空格视为同一个键。 */
export function reinspectionBusinessKey(row: ReinspectionIdentity): string {
  return [row.purchaseOrderNo, row.sku, row.demandNo, row.transferOrderNo]
    .map((part) => part.trim())
    .join('\u001f');
}

export type ReinspectionTargetIdentity = ReinspectionIdentity & {
  targetRecordId: string;
  sourceRecordId: string;
  firstInsertedAtMs: number | null;
};

export type ReinspectionWritePlan = {
  creates: string[];
  refreshes: Array<{ targetRecordId: string; sourceRecordId: string }>;
  deletes: string[];
};

function compareTargetIdentity(a: ReinspectionTargetIdentity, b: ReinspectionTargetIdentity): number {
  const aTime = a.firstInsertedAtMs ?? Number.POSITIVE_INFINITY;
  const bTime = b.firstInsertedAtMs ?? Number.POSITIVE_INFINITY;
  if (aTime !== bTime) return aTime - bTime;
  return a.targetRecordId.localeCompare(b.targetRecordId);
}

/**
 * 同一个业务键只写一行。目标表已有该键时更新最早插入的那条，其余重复行删除。
 * 源视图里同一个键出现多次时，只保留最后一条。
 */
export function planReinspectionWrites(input: {
  source: Array<ReinspectionIdentity & { recordId: string }>;
  target: ReinspectionTargetIdentity[];
}): ReinspectionWritePlan {
  const sourceByKey = new Map<string, ReinspectionIdentity & { recordId: string }>();
  for (const row of input.source) {
    sourceByKey.set(reinspectionBusinessKey(row), row);
  }

  const targetByKey = new Map<string, ReinspectionTargetIdentity[]>();
  for (const row of input.target) {
    const key = reinspectionBusinessKey(row);
    const group = targetByKey.get(key);
    if (group) group.push(row);
    else targetByKey.set(key, [row]);
  }

  const creates: string[] = [];
  const refreshes: ReinspectionWritePlan['refreshes'] = [];
  const deletes: string[] = [];

  for (const [key, source] of sourceByKey) {
    const group = targetByKey.get(key);
    if (!group?.length) {
      creates.push(source.recordId);
      continue;
    }
    const sorted = [...group].sort(compareTargetIdentity);
    const canonical = sorted[0]!;
    refreshes.push({
      targetRecordId: canonical.targetRecordId,
      sourceRecordId: source.recordId,
    });
    for (const extra of sorted.slice(1)) deletes.push(extra.targetRecordId);
    targetByKey.delete(key);
  }

  for (const group of targetByKey.values()) {
    const sorted = [...group].sort(compareTargetIdentity);
    for (const extra of sorted.slice(1)) deletes.push(extra.targetRecordId);
  }

  return { creates, refreshes, deletes };
}

export function collectFactoryWhitelist(
  rows: Array<{ factoryName: string; sourceRecordId: string }>,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.sourceRecordId.trim()) continue;
    const name = row.factoryName.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** 飞书目标表无占位行时，从采购跟进「二次验货」视图里的「工厂名称」去重得到范围。 */
export function collectFactoryNamesFromSource(rows: Array<{ factoryName: string }>): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = row.factoryName.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

function putText(fields: Record<string, string | number>, key: string, value: string) {
  const trimmed = value.trim();
  if (trimmed) fields[key] = trimmed;
}

function putNumber(fields: Record<string, string | number>, key: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) return;
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) fields[key] = parsed;
}

function businessFields(row: QcSourceSnapshot): Record<string, string | number> {
  const fields: Record<string, string | number> = {
    来源记录ID: row.recordId,
  };
  putText(fields, '供应商简称', row.supplierShortName);
  putText(fields, '验货状态', row.inspectionStatus);
  putText(fields, '采购单号', row.purchaseOrderNo);
  putText(fields, '需求单号', row.demandNo);
  putText(fields, 'SKU', row.sku);
  putText(fields, '品名', row.productName);
  putNumber(fields, '总箱数', row.cartonCount);
  putNumber(fields, '总件数', row.pieceCount);
  putText(fields, '目的仓', row.destWarehouse);
  putText(fields, '工厂类型', row.factoryType);
  putText(fields, '期望出货日期', row.expectedShipDate);
  putNumber(fields, '货柜实发箱数', row.containerCartonCount);
  putNumber(fields, '货柜实发数量', row.containerPieceCount);
  putText(fields, '调拨单号', row.transferOrderNo);
  putText(fields, '调拨状态', row.transferStatus);
  if (row.followUpReadyAtMs != null) fields['跟单货好时间'] = row.followUpReadyAtMs;
  if (row.goodsReadyAtMs != null) fields['货好时间'] = row.goodsReadyAtMs;
  putText(fields, '装柜备注', row.loadingNote);
  if (row.gapDays != null && Number.isFinite(row.gapDays)) {
    fields['跟单货好时间-期望出货时间差'] = row.gapDays;
  }
  return fields;
}

/** 新行：两个时间都写成这一次。 */
export function buildReinspectionBitableFields(
  row: QcSourceSnapshot,
  atMs: number,
): Record<string, string | number> {
  return {
    ...businessFields(row),
    首次插入时间: atMs,
    数据同步时间: atMs,
  };
}

/**
 * 已有行：刷新业务字段和数据同步时间。
 * firstInsertedAtMs 只在目标行还没有「首次插入时间」时传入，用来从旧的「插入时间」补一次。
 */
export function buildReinspectionRefreshFields(
  row: QcSourceSnapshot,
  syncedAtMs: number,
  firstInsertedAtMs: number | null,
): Record<string, string | number> {
  const fields = businessFields(row);
  fields['数据同步时间'] = syncedAtMs;
  if (firstInsertedAtMs != null) fields['首次插入时间'] = firstInsertedAtMs;
  return fields;
}
