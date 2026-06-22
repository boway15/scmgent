import { buildFeePriorityMap, sortFeeChecksByDisplayPriority } from '@scm/db/fee-display-priority';
import type { AllocationRow } from './fob-settlement.js';

export type ReconcileExportAllocation = AllocationRow & {
  merchantName?: string | null;
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

const FIXED_HEADERS = ['柜号', '主体名称', '体积m³', '合计'] as const;

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
  return `${sanitizeExportFileName(batchNo)}_按公司导出_${sanitizeExportFileName(settlementPeriod)}.zip`;
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
