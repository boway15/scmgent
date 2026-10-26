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
