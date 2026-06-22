import { FREIGHT_FEE_HEADERS, TRUCKING_FEE_HEADERS } from '@scm/db';
import { buildFeePriorityMap, sortFeeChecksByDisplayPriority } from '@scm/db/fee-display-priority';
import { paymentStatusLabel, type PaymentStatus } from './fob-payment-status.js';
import type { AllocationRow } from './fob-settlement.js';

export type ReconcileExportAllocation = AllocationRow & {
  merchantName?: string | null;
};

export type ReconcileExportMeta = {
  batchNo: string;
  settlementPeriod: string;
  settlementTypeLabel: string;
  providerName: string;
};

export type ReconcileExportPayment = {
  paymentStatus: PaymentStatus;
  remark: string | null;
};

type FeeColumn = {
  key: string;
  feeType: string;
  sourceBillType: 'trucking' | 'freight';
  header: string;
};

type RowGroup = {
  containerNo: string;
  merchantCode: string;
  merchantName: string | null;
  volumeCbm: number;
  amounts: Map<string, number>;
};

type FeeDetail = {
  feeType: string;
  sourceBillType: 'trucking' | 'freight';
  sourceBillItemId: string;
  merchantAmount: number;
  billAmount: number;
};

const MERCHANT_BILL_APPEND_HEADERS = [
  '合计金额',
  '承担金额',
  '总体积',
  '承担体积',
  '体积占比',
  '承担工厂/主体',
  '收款公司名称',
] as const;

const TRUCKING_BILL_META_HEADERS = [
  '货柜号',
  '业务编号',
  '提单号',
  '起始港',
  '船公司',
  '发货时间',
] as const;

const FREIGHT_BILL_META_HEADERS = [
  '货柜号',
  '业务编号',
  '提单号',
  '起始港',
  '船公司',
  '进港时间',
] as const;

export type TruckingBillExportItem = {
  containerNo: string;
  internalNo?: string | null;
  blNo?: string | null;
  shipDate?: string | null;
  loadAddress?: string | null;
  feeType: string;
  amountCny: string | number;
};

export type FreightBillExportItem = {
  containerNo: string;
  orderNo?: string | null;
  blNo?: string | null;
  bizDate?: string | null;
  destPort?: string | null;
  feeType: string;
  amountCny: string | number;
};

export type ContainerStatExportItem = {
  containerNo: string;
  merchantCode: string;
  merchantName?: string | null;
  volumeCbm: string | number;
};

type BillWideRow = {
  containerNo: string;
  meta: string[];
  fees: Map<string, number>;
};

function round4(n: number) {
  return Math.round(n * 10_000) / 10_000;
}

function pivotTruckingBillItems(items: TruckingBillExportItem[]): Map<string, BillWideRow> {
  const map = new Map<string, BillWideRow>();
  for (const item of items) {
    if (!map.has(item.containerNo)) {
      map.set(item.containerNo, {
        containerNo: item.containerNo,
        meta: [
          item.containerNo,
          item.internalNo?.trim() ?? '',
          item.blNo?.trim() ?? '',
          item.loadAddress?.trim() ?? '',
          '',
          item.shipDate?.trim() ?? '',
        ],
        fees: new Map(),
      });
    }
    const row = map.get(item.containerNo)!;
    const amount = round2(Number(item.amountCny));
    if (amount <= 0) continue;
    row.fees.set(item.feeType, round2((row.fees.get(item.feeType) ?? 0) + amount));
  }
  return map;
}

function pivotFreightBillItems(items: FreightBillExportItem[]): Map<string, BillWideRow> {
  const map = new Map<string, BillWideRow>();
  for (const item of items) {
    if (!map.has(item.containerNo)) {
      map.set(item.containerNo, {
        containerNo: item.containerNo,
        meta: [
          item.containerNo,
          item.orderNo?.trim() ?? '',
          item.blNo?.trim() ?? '',
          item.destPort?.trim() ?? '',
          '',
          item.bizDate?.trim() ?? '',
        ],
        fees: new Map(),
      });
    }
    const row = map.get(item.containerNo)!;
    const amount = round2(Number(item.amountCny));
    if (amount <= 0) continue;
    row.fees.set(item.feeType, round2((row.fees.get(item.feeType) ?? 0) + amount));
  }
  return map;
}

function buildContainerVolumeTotals(stats: ContainerStatExportItem[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of stats) {
    map.set(row.containerNo, round4((map.get(row.containerNo) ?? 0) + Number(row.volumeCbm)));
  }
  return map;
}

function buildMerchantVolumeByContainer(
  stats: ContainerStatExportItem[],
  merchantCode: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of stats) {
    if (row.merchantCode !== merchantCode) continue;
    map.set(row.containerNo, round4(Number(row.volumeCbm)));
  }
  return map;
}

function sumAllocatedByContainer(
  allocations: ReconcileExportAllocation[],
  merchantCode: string,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of allocations) {
    if (row.merchantCode !== merchantCode) continue;
    map.set(row.containerNo, round2((map.get(row.containerNo) ?? 0) + row.allocatedAmountCny));
  }
  return map;
}

function merchantContainers(
  allocations: ReconcileExportAllocation[],
  merchantCode: string,
): string[] {
  return [...new Set(allocations.filter((a) => a.merchantCode === merchantCode).map((a) => a.containerNo))].sort(
    (a, b) => a.localeCompare(b, 'en'),
  );
}

function merchantDisplayName(
  allocations: ReconcileExportAllocation[],
  merchantCode: string,
): string {
  const row = allocations.find((a) => a.merchantCode === merchantCode);
  return row?.merchantName?.trim() || merchantCode;
}

function emptyBillWideRow(containerNo: string, metaLength: number): BillWideRow {
  return {
    containerNo,
    meta: [containerNo, ...Array.from({ length: metaLength - 1 }, () => '')],
    fees: new Map(),
  };
}

/** 按工厂/主体导出：账单宽表 + 分摊汇总列 */
export function buildMerchantBillWideExportAoa(params: {
  settlementType: 'trucking' | 'freight';
  allocations: ReconcileExportAllocation[];
  merchantCode: string;
  providerName: string;
  truckingItems: TruckingBillExportItem[];
  freightItems: FreightBillExportItem[];
  containerStats: ContainerStatExportItem[];
}): unknown[][] {
  const {
    settlementType,
    allocations,
    merchantCode,
    providerName,
    truckingItems,
    freightItems,
    containerStats,
  } = params;

  const metaHeaders =
    settlementType === 'trucking' ? TRUCKING_BILL_META_HEADERS : FREIGHT_BILL_META_HEADERS;
  const feeHeaders = settlementType === 'trucking' ? TRUCKING_FEE_HEADERS : FREIGHT_FEE_HEADERS;
  const billByContainer =
    settlementType === 'trucking'
      ? pivotTruckingBillItems(truckingItems)
      : pivotFreightBillItems(freightItems);

  const containerTotals = containerBillTotals(allocations);
  const containerVolumeTotals = buildContainerVolumeTotals(containerStats);
  const merchantVolumes = buildMerchantVolumeByContainer(containerStats, merchantCode);
  const merchantAllocated = sumAllocatedByContainer(allocations, merchantCode);
  const merchantLabel = merchantDisplayName(allocations, merchantCode);
  const containers = merchantContainers(allocations, merchantCode);

  const header = [...metaHeaders, ...feeHeaders, ...MERCHANT_BILL_APPEND_HEADERS];
  const rows: unknown[][] = [header];

  for (const containerNo of containers) {
    const bill =
      billByContainer.get(containerNo) ??
      emptyBillWideRow(containerNo, metaHeaders.length);
    const feeCells = feeHeaders.map((feeType) => bill.fees.get(feeType) ?? 0);
    const totalVolume = containerVolumeTotals.get(containerNo) ?? 0;
    const merchantVolume = merchantVolumes.get(containerNo) ?? 0;
    const volumeRatio = totalVolume > 0 ? round4(merchantVolume / totalVolume) : 0;

    rows.push([
      ...bill.meta,
      ...feeCells,
      round2(containerTotals.get(containerNo) ?? 0),
      round2(merchantAllocated.get(containerNo) ?? 0),
      totalVolume,
      merchantVolume,
      volumeRatio,
      merchantLabel,
      providerName,
    ]);
  }

  return rows;
}

export type MerchantBillWideExportParams = {
  settlementType: 'trucking' | 'freight';
  allocations: ReconcileExportAllocation[];
  providerName: string;
  truckingItems: TruckingBillExportItem[];
  freightItems: FreightBillExportItem[];
  containerStats: ContainerStatExportItem[];
};

/** 分摊总账：全部工厂/主体宽表合集（与各主体导出文件行数据一致） */
export function buildTotalBillWideExportAoa(params: MerchantBillWideExportParams): unknown[][] {
  const merchants = listMerchantsForExport(params.allocations);
  const combined: unknown[][] = [];

  for (const merchant of merchants) {
    const rows = buildMerchantBillWideExportAoa({
      ...params,
      merchantCode: merchant.merchantCode,
    });
    if (combined.length === 0) {
      combined.push(...rows);
    } else if (rows.length > 1) {
      combined.push(...rows.slice(1));
    }
  }

  return combined;
}

const FIXED_HEADERS = ['柜号', '工厂/主体名称', '体积m³', '合计'] as const;

const TIERED_HEADERS = [
  '行类型',
  '柜号',
  '工厂/主体名称',
  '费用项',
  '体积m³',
  '工厂/主体金额',
  '本柜/本费总额',
  '是否付款',
  '备注',
] as const;

export function sanitizeExportFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
  return cleaned.slice(0, 80) || '未命名';
}

export function feeColumnKey(feeType: string, sourceBillType: string) {
  return `${sourceBillType}|${feeType}`;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function buildFeeColumns(
  allocations: ReconcileExportAllocation[],
  priorityMap: Map<string, number>,
): FeeColumn[] {
  const map = new Map<string, FeeColumn>();
  for (const row of allocations) {
    const key = feeColumnKey(row.feeType, row.sourceBillType);
    if (!map.has(key)) {
      map.set(key, {
        key,
        feeType: row.feeType,
        sourceBillType: row.sourceBillType as 'trucking' | 'freight',
        header: row.feeType,
      });
    }
  }
  const sorted = sortFeeChecksByDisplayPriority(
    [...map.values()].map((c) => ({ feeType: c.feeType, sourceBillType: c.sourceBillType })),
    priorityMap,
  );
  return sorted.map((c) => map.get(feeColumnKey(c.feeType, c.sourceBillType))!);
}

function buildRowGroups(
  allocations: ReconcileExportAllocation[],
  merchantFilter?: string,
): RowGroup[] {
  const groups = new Map<string, RowGroup>();

  for (const row of allocations) {
    if (merchantFilter && row.merchantCode !== merchantFilter) continue;

    const groupKey = `${row.containerNo}|${row.merchantCode}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        containerNo: row.containerNo,
        merchantCode: row.merchantCode,
        merchantName: row.merchantName ?? null,
        volumeCbm: row.merchantVolumeCbm,
        amounts: new Map(),
      });
    }
    const group = groups.get(groupKey)!;
    if (!group.merchantName && row.merchantName) group.merchantName = row.merchantName;
    if (row.merchantVolumeCbm > group.volumeCbm) group.volumeCbm = row.merchantVolumeCbm;

    const colKey = feeColumnKey(row.feeType, row.sourceBillType);
    group.amounts.set(colKey, round2(row.allocatedAmountCny));
  }

  return [...groups.values()].sort(
    (a, b) =>
      a.containerNo.localeCompare(b.containerNo, 'en') ||
      a.merchantCode.localeCompare(b.merchantCode, 'en'),
  );
}

/** 宽表：固定列 + 动态费用列，含 ¥0 占位 */
export function buildReconcileWideTableAoa(
  allocations: ReconcileExportAllocation[],
  feeRules: Array<{
    feeType: string | null;
    sourceBillType: string;
    matchPattern: string | null;
    priority: number;
  }>,
  merchantFilter?: string,
): unknown[][] {
  const priorityMap = buildFeePriorityMap(feeRules);
  const feeColumns = buildFeeColumns(allocations, priorityMap);
  const groups = buildRowGroups(allocations, merchantFilter);

  const header = [...FIXED_HEADERS, ...feeColumns.map((c) => c.header)];
  const rows: unknown[][] = [header];

  for (const group of groups) {
    let rowTotal = 0;
    const feeCells = feeColumns.map((col) => {
      const amount = group.amounts.get(col.key) ?? 0;
      rowTotal += amount;
      return amount;
    });
    rows.push([
      group.containerNo,
      group.merchantName?.trim() || group.merchantCode,
      round2(group.volumeCbm),
      round2(rowTotal),
      ...feeCells,
    ]);
  }

  return rows;
}

function containerBillTotals(allocations: ReconcileExportAllocation[]): Map<string, number> {
  const byItem = new Map<string, { containerNo: string; amount: number }>();
  for (const row of allocations) {
    if (!row.sourceBillItemId) continue;
    if (!byItem.has(row.sourceBillItemId)) {
      byItem.set(row.sourceBillItemId, {
        containerNo: row.containerNo,
        amount: row.sourceAmountCny,
      });
    }
  }
  const totals = new Map<string, number>();
  for (const { containerNo, amount } of byItem.values()) {
    totals.set(containerNo, round2((totals.get(containerNo) ?? 0) + amount));
  }
  return totals;
}

function feeDetailsForMerchantContainer(
  allocations: ReconcileExportAllocation[],
  merchantCode: string,
  containerNo: string,
): FeeDetail[] {
  const map = new Map<string, FeeDetail>();
  for (const row of allocations) {
    if (row.merchantCode !== merchantCode || row.containerNo !== containerNo) continue;
    if (!row.sourceBillItemId) continue;
    const existing = map.get(row.sourceBillItemId);
    if (!existing) {
      map.set(row.sourceBillItemId, {
        feeType: row.feeType,
        sourceBillType: row.sourceBillType as 'trucking' | 'freight',
        sourceBillItemId: row.sourceBillItemId,
        merchantAmount: row.allocatedAmountCny,
        billAmount: row.sourceAmountCny,
      });
    } else {
      existing.merchantAmount = round2(existing.merchantAmount + row.allocatedAmountCny);
    }
  }
  return [...map.values()].sort((a, b) => a.feeType.localeCompare(b.feeType, 'zh-CN'));
}

/** 两级明细：柜汇总行 + 费用明细行 */
export function buildReconcileTieredTableAoa(params: {
  allocations: ReconcileExportAllocation[];
  meta: ReconcileExportMeta;
  merchantFilter?: string;
  payment?: ReconcileExportPayment;
}): unknown[][] {
  const { allocations, meta, merchantFilter, payment } = params;
  const groups = buildRowGroups(allocations, merchantFilter);
  const containerTotals = containerBillTotals(allocations);
  const rows: unknown[][] = [
    ['账期', meta.settlementPeriod, '分账类型', meta.settlementTypeLabel, '服务商', meta.providerName, '批次编号', meta.batchNo],
    [...TIERED_HEADERS],
  ];

  const paymentLabel = payment ? paymentStatusLabel(payment.paymentStatus) : '';
  const paymentRemark = payment?.remark ?? '';

  for (const group of groups) {
    const merchantTotal = [...group.amounts.values()].reduce((sum, n) => sum + n, 0);
    const containerTotal = containerTotals.get(group.containerNo) ?? merchantTotal;
    rows.push([
      '汇总',
      group.containerNo,
      group.merchantName?.trim() || group.merchantCode,
      '',
      round2(group.volumeCbm),
      round2(merchantTotal),
      round2(containerTotal),
      paymentLabel,
      paymentRemark,
    ]);

    for (const fee of feeDetailsForMerchantContainer(
      allocations,
      group.merchantCode,
      group.containerNo,
    )) {
      rows.push([
        '明细',
        group.containerNo,
        '',
        fee.feeType,
        '',
        round2(fee.merchantAmount),
        round2(fee.billAmount),
        '',
        '',
      ]);
    }
  }

  return rows;
}

export function buildMerchantExportFileName(
  merchantName: string | null | undefined,
  merchantCode: string,
  settlementPeriod: string,
): string {
  const label = sanitizeExportFileName(merchantName?.trim() || merchantCode);
  const period = sanitizeExportFileName(settlementPeriod);
  return `${label}${period}.xlsx`;
}

export function buildTotalExportFileName(batchNo: string, settlementPeriod: string): string {
  return `${sanitizeExportFileName(batchNo)}_分摊总账_${sanitizeExportFileName(settlementPeriod)}.xlsx`;
}

export function buildByMerchantZipFileName(batchNo: string, settlementPeriod: string): string {
  return `${sanitizeExportFileName(batchNo)}_按工厂主体导出_${sanitizeExportFileName(settlementPeriod)}.zip`;
}

export async function buildXlsxBuffer(rows: unknown[][], sheetName = '分摊平账'): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return Buffer.from(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer);
}

export async function buildZipBuffer(files: Array<{ name: string; buffer: Buffer }>): Promise<Buffer> {
  const archiver = (await import('archiver')).default;
  const { PassThrough } = await import('stream');

  return new Promise((resolve, reject) => {
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.pipe(stream);

    for (const file of files) {
      archive.append(file.buffer, { name: file.name });
    }
    archive.finalize();
  });
}

export function contentDispositionAttachment(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export function listMerchantsForExport(allocations: ReconcileExportAllocation[]) {
  const map = new Map<string, { merchantCode: string; merchantName: string | null }>();
  for (const row of allocations) {
    if (!map.has(row.merchantCode)) {
      map.set(row.merchantCode, {
        merchantCode: row.merchantCode,
        merchantName: row.merchantName ?? null,
      });
    } else if (!map.get(row.merchantCode)!.merchantName && row.merchantName) {
      map.get(row.merchantCode)!.merchantName = row.merchantName;
    }
  }
  return [...map.values()].sort((a, b) => a.merchantCode.localeCompare(b.merchantCode, 'en'));
}
