import { excelSerialToIsoDate, isPlausibleExcelSerial } from './turnover-date-format.js';
import type { SupplyLotDraftInput } from './inventory-supply-lots.js';

export type WarehouseLabelResolver = (label: string | undefined) => string | null;

const WAREHOUSE_LABEL_RULES: Array<{ test: (label: string) => boolean; code: string }> = [
  { test: (l) => l === 'US-EAST' || /美东/.test(l), code: 'US-EAST' },
  { test: (l) => l === 'US-WEST' || /美西/.test(l), code: 'US-WEST' },
  { test: (l) => l === 'US-SOUTH' || /美南/.test(l), code: 'US-SOUTH' },
  { test: (l) => l === 'US-CENTRAL' || /美中/.test(l), code: 'US-CENTRAL' },
  { test: (l) => l === 'US-SOUTHEAST' || /美东南/.test(l), code: 'US-SOUTHEAST' },
  { test: (l) => l === 'DE' || /德国/.test(l), code: 'DE' },
  { test: (l) => /平台仓.*美|PLATFORM-US/i.test(l), code: 'PLATFORM-US' },
  { test: (l) => /平台仓.*欧|PLATFORM-EU/i.test(l), code: 'PLATFORM-EU' },
];

export function createWarehouseLabelResolver(params: {
  warehouseCodes: string[];
  warehouseNames?: Record<string, string>;
}): WarehouseLabelResolver {
  const codeSet = new Set(params.warehouseCodes);
  return (label) => {
    const raw = label?.trim();
    if (!raw) return null;
    if (codeSet.has(raw)) return raw;
    for (const rule of WAREHOUSE_LABEL_RULES) {
      if (rule.test(raw)) return rule.code;
    }
    for (const code of params.warehouseCodes) {
      const name = params.warehouseNames?.[code]?.trim();
      if (name && (raw === name || raw.includes(name) || name.includes(raw))) return code;
    }
    return null;
  };
}

export function parseProcurementMirrorDate(raw: string | undefined): string | null {
  const text = raw?.trim();
  if (!text || text === '-') return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = Number(text.replace(/,/g, ''));
  if (Number.isFinite(parsed) && isPlausibleExcelSerial(parsed)) {
    return excelSerialToIsoDate(parsed);
  }
  return null;
}

function parseMirrorQty(raw: string | undefined): number {
  const n = Math.floor(Number(String(raw ?? '').replace(/,/g, '')));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function extractSkuCodeFromMirrorRow(row: Record<string, string>): string {
  return (row.SKU ?? row.sku ?? row['sku_code'] ?? row.WSKU ?? '').trim();
}

/** 飞书采购跟单「状态」→ 内部跟单状态（与 mapDraftToLotPool 兼容） */
export function mapFeishuFollowUpStatus(raw: string | undefined): string | null {
  const s = (raw ?? '').trim();
  if (!s) return 'confirmed';
  if (/取消|作废|关闭|终止/.test(s)) return 'cancelled';
  if (/已?收货|到货完成|已入库|入库完成|已完成/.test(s)) return 'received';
  if (/部分到货|部分入库|部分收货/.test(s)) return 'partial_received';
  if (/在途|海运在途|运输中|已发货/.test(s)) return 'in_transit';
  if (/待发货|可发货|货好|待出运/.test(s)) return 'ready_to_ship';
  if (/生产|加工|做货/.test(s)) return 'in_production';
  if (/待确认|待供应商|订单确认/.test(s)) return 'confirmed';
  if (/异常|延期/.test(s)) return 'exception';
  return 'in_production';
}

export function buildDestWarehouseByRequestNo(
  bulkRows: Array<{ rowData: Record<string, string> }>,
  resolveWarehouse: WarehouseLabelResolver,
): Map<string, string | null> {
  const map = new Map<string, string | null>();
  for (const row of bulkRows) {
    const data = row.rowData ?? {};
    const requestNo = (data['需求单号'] ?? '').trim();
    if (!requestNo) continue;
    const destLabel = data['目的仓']?.trim();
    map.set(requestNo, resolveWarehouse(destLabel));
  }
  return map;
}

export function feishuFollowUpRowsToDraftInputs(params: {
  rows: Array<{
    rowIndex: number;
    bitableRecordId?: string | null;
    rowData: Record<string, string>;
  }>;
  skuCodeToId: Map<string, string>;
  destByRequestNo: Map<string, string | null>;
  resolveWarehouse: WarehouseLabelResolver;
}): SupplyLotDraftInput[] {
  const drafts: SupplyLotDraftInput[] = [];

  for (const row of params.rows) {
    const data = row.rowData ?? {};
    const skuCode = extractSkuCodeFromMirrorRow(data);
    const skuId = skuCode ? params.skuCodeToId.get(skuCode) : undefined;
    if (!skuId) continue;

    const status = mapFeishuFollowUpStatus(data['状态'] ?? data['单据状态']);
    if (!status || status === 'received' || status === 'cancelled') continue;

    const openQty =
      parseMirrorQty(data['未入库数量']) || parseMirrorQty(data['采购数量']);
    if (openQty <= 0) continue;

    const requestNo = (data['需求单号'] ?? '').trim();
    const destFromBulk = requestNo ? params.destByRequestNo.get(requestNo) : undefined;
    const warehouseCode =
      destFromBulk !== undefined
        ? destFromBulk
        : params.resolveWarehouse(data['目的仓']);

    const shipReadyAt = parseProcurementMirrorDate(data['预计货好时间']);
    const confirmed = parseProcurementMirrorDate(data['确认交期']);
    const delivery = parseProcurementMirrorDate(data['交货日期']);
    const etaAvailable = confirmed ?? delivery;

    const sourceKey =
      row.bitableRecordId?.trim() ||
      (requestNo ? `req:${requestNo}` : `row:${row.rowIndex}`);

    drafts.push({
      draftId: `feishu:follow-up:${sourceKey}`,
      skuId,
      warehouseCode,
      status,
      openQty,
      shipReadyAt,
      plannedProductionDoneDate: shipReadyAt,
      etaAvailable,
      remainingLogisticsDays: 0,
    });
  }

  return drafts;
}
