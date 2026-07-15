import { decodeCsvBytes, parseDelimitedText, sanitizeCsvText } from './import/parse.js';
import { yieldToEventLoop } from './yield-event-loop.js';

const DAILY_PARSE_YIELD_EVERY_SOURCE_ROWS = 25;

export type DailySalesDateColumn = {
  key: string;
  saleDate: string;
};

export type DailySalesRow = {
  skuCode: string;
  skuName: string;
  station: string;
  platformRaw: string;
  firstOrderAt: string;
  category: string;
  saleDate: string;
  qtySold: number;
};

export type DailySalesDiagnostics = {
  rowCount: number;
  expandedRowCount: number;
  skuCount: number;
  startDate: string | null;
  endDate: string | null;
  stationCounts: Record<string, number>;
  platformCounts: Record<string, number>;
  errors: string[];
};

export type DailySalesParseResult = {
  rows: DailySalesRow[];
  diagnostics: DailySalesDiagnostics;
};

export type MonthlyTrendRow = {
  dimensionType: 'project_group' | 'category';
  dimensionValue: string;
  month: string;
  qtySold: number;
};

export type SkuMonthlySalesColumn = {
  key: string;
  saleYear: number;
  month: number;
};

export type SkuMonthlySalesRow = {
  skuCode: string;
  skuName: string;
  station: string;
  platformRaw: string;
  category: string;
  saleYear: number;
  month: number;
  qtySold: number;
};

export type SkuMonthlySalesDiagnostics = {
  rowCount: number;
  expandedRowCount: number;
  skuCount: number;
  startMonth: string | null;
  endMonth: string | null;
  errors: string[];
};

export type SkuMonthlySalesParseResult = {
  rows: SkuMonthlySalesRow[];
  diagnostics: SkuMonthlySalesDiagnostics;
};

const DAILY_DATE_COLUMN_RE = /^\((\d{4}-\d{2}-\d{2})\)$/;
/** Supports 2026-05, 2026-05), 2026.5, (2026-05), (2026-5) — aligned with daily parenthesized headers */
const MONTH_HEADER_RE = /^\(?(\d{4})[-.](\d{1,2})\)?$/;

export function detectDailySalesDateColumns(
  headers: string[],
  minSaleDate?: string,
): DailySalesDateColumn[] {
  return headers.flatMap((header) => {
    const match = DAILY_DATE_COLUMN_RE.exec(header.trim());
    if (!match) return [];
    if (minSaleDate && match[1] < minSaleDate) return [];
    return [{ key: header, saleDate: match[1] }];
  });
}

export function normalizeStationFromReport(raw?: string | null): string {
  const value = raw?.trim();
  if (!value) return 'US';

  const upper = value.toUpperCase();
  if (value.includes('德国') || /\bDE\b/.test(upper) || upper.includes('GERMANY')) {
    return 'DE';
  }
  if (value.includes('英国') || /\bUK\b/.test(upper) || /\bGB\b/.test(upper) || upper.includes('UNITED KINGDOM')) {
    return 'UK';
  }
  if (
    value.includes('美国') ||
    /\bUS\b/.test(upper) ||
    /\bUSA\b/.test(upper) ||
    upper.includes('WAYFAIR') ||
    upper.includes('WALMART') ||
    value.includes('沃尔玛') ||
    upper.includes('SHOPIFY') ||
    upper.includes('TIKTOK') ||
    upper.includes('EBAY') ||
    upper.includes('TEMU')
  ) {
    return 'US';
  }

  return 'US';
}

export type DailySalesExpansionEstimate = {
  skuRowCount: number;
  dateColumnCount: number;
  /** 宽表最坏情况展开行数（SKU 行 × 日期列），用于判断是否走后台导入 */
  expandedRowEstimate: number;
};

export function estimateDailySalesExpansion(
  rows: Array<Record<string, string>>,
  minSaleDate?: string,
): DailySalesExpansionEstimate {
  if (!rows.length) {
    return { skuRowCount: 0, dateColumnCount: 0, expandedRowEstimate: 0 };
  }

  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const dateColumnCount = detectDailySalesDateColumns(headers, minSaleDate).length;

  return {
    skuRowCount: rows.length,
    dateColumnCount,
    expandedRowEstimate: rows.length * dateColumnCount,
  };
}

function expandDailySalesWideRow(
  row: Record<string, string>,
  index: number,
  dateColumns: DailySalesDateColumn[],
  parsedRows: DailySalesRow[],
  errors: string[],
): void {
  const skuCode = getText(row, ['SKU', 'sku', 'skuCode']);
  if (!skuCode) {
    errors.push(`Row ${index + 1} missing SKU`);
    return;
  }

  for (const column of dateColumns) {
    const qtySold = parsePositiveNumber(row[column.key]);
    if (qtySold === null) continue;

    parsedRows.push({
      skuCode,
      skuName: getText(row, ['SKU名称', 'SKU名称 ', 'skuName']),
      station: normalizeStationFromReport(getText(row, ['站点', 'station'])),
      platformRaw: getText(row, ['平台', 'platform']),
      firstOrderAt: getText(row, ['首单时间', 'firstOrderAt']),
      category: getText(row, ['品类', 'category']),
      saleDate: column.saleDate,
      qtySold,
    });
  }
}

function buildDailySalesParseResult(
  sourceRows: Array<Record<string, string>>,
  parsedRows: DailySalesRow[],
  errors: string[],
): DailySalesParseResult {
  const saleDates = parsedRows.map((row) => row.saleDate).sort();

  return {
    rows: parsedRows,
    diagnostics: {
      rowCount: sourceRows.length,
      expandedRowCount: parsedRows.length,
      skuCount: new Set(parsedRows.map((row) => row.skuCode)).size,
      startDate: saleDates[0] ?? null,
      endDate: saleDates[saleDates.length - 1] ?? null,
      stationCounts: countBy(parsedRows, (row) => row.station),
      platformCounts: countBy(parsedRows, (row) => row.platformRaw),
      errors,
    },
  };
}

export function parseDailySalesRows(
  rows: Array<Record<string, string>>,
  minSaleDate?: string,
): DailySalesParseResult {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const dateColumns = detectDailySalesDateColumns(headers, minSaleDate);
  const parsedRows: DailySalesRow[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    expandDailySalesWideRow(row, index, dateColumns, parsedRows, errors);
  });

  return buildDailySalesParseResult(rows, parsedRows, errors);
}

/** 分片解析日宽表，定期 yield 避免阻塞 Node 事件循环 */
export async function parseDailySalesRowsAsync(
  rows: Array<Record<string, string>>,
  minSaleDate?: string,
): Promise<DailySalesParseResult> {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const dateColumns = detectDailySalesDateColumns(headers, minSaleDate);
  const parsedRows: DailySalesRow[] = [];
  const errors: string[] = [];

  for (let index = 0; index < rows.length; index++) {
    if (index > 0 && index % DAILY_PARSE_YIELD_EVERY_SOURCE_ROWS === 0) {
      await yieldToEventLoop();
    }
    expandDailySalesWideRow(rows[index], index, dateColumns, parsedRows, errors);
  }

  return buildDailySalesParseResult(rows, parsedRows, errors);
}

export function detectSkuMonthlySalesColumns(headers: string[]): SkuMonthlySalesColumn[] {
  return headers.flatMap((header) => {
    const month = parseMonthHeader(header);
    if (!month) return [];
    const [yearText, monthText] = month.split('-');
    return [
      {
        key: header,
        saleYear: Number(yearText),
        month: Number(monthText),
      },
    ];
  });
}

export function parseSkuMonthlyWideRows(rows: Array<Record<string, string>>): SkuMonthlySalesParseResult {
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const monthColumns = detectSkuMonthlySalesColumns(headers);
  const parsedRows: SkuMonthlySalesRow[] = [];
  const errors: string[] = [];

  rows.forEach((row, index) => {
    const skuCode = getText(row, ['SKU', 'sku', 'skuCode']);
    if (!skuCode) {
      errors.push(`Row ${index + 1} missing SKU`);
      return;
    }

    for (const column of monthColumns) {
      const qtySold = parsePositiveNumber(row[column.key]);
      if (qtySold === null) continue;

      parsedRows.push({
        skuCode,
        skuName: getText(row, ['SKU名称', 'SKU名称 ', 'skuName']),
        station: normalizeStationFromReport(getText(row, ['站点', 'station'])),
        platformRaw: getText(row, ['平台', 'platform']),
        category: getText(row, ['品类', 'category']),
        saleYear: column.saleYear,
        month: column.month,
        qtySold,
      });
    }
  });

  const monthKeys = parsedRows
    .map((row) => `${row.saleYear}-${String(row.month).padStart(2, '0')}`)
    .sort();

  return {
    rows: parsedRows,
    diagnostics: {
      rowCount: rows.length,
      expandedRowCount: parsedRows.length,
      skuCount: new Set(parsedRows.map((row) => row.skuCode)).size,
      startMonth: monthKeys[0] ?? null,
      endMonth: monthKeys[monthKeys.length - 1] ?? null,
      errors,
    },
  };
}

export function parseMonthlySalesWorkbookRows(workbook: Record<string, unknown[][]>): { rows: MonthlyTrendRow[] } {
  const rows: MonthlyTrendRow[] = [];

  for (const [sheetName, sheetRows] of Object.entries(workbook)) {
    const dimensionType = getMonthlyDimensionType(sheetName);
    if (!dimensionType) continue;

    const headerIndex = sheetRows.findIndex((row) => {
      const firstCell = normalizeReportKey(row[0]);
      return dimensionType === 'project_group' ? firstCell.includes('项目组') : firstCell.includes('品类');
    });
    if (headerIndex === -1) continue;

    const headerRow = sheetRows[headerIndex];
    const monthColumns = headerRow.flatMap((cell, index) => {
      if (index === 0) return [];
      const month = parseMonthHeader(cell);
      return month ? [{ index, month }] : [];
    });

    for (const row of sheetRows.slice(headerIndex + 1)) {
      const dimensionValue = stringifyCell(row[0]).trim();
      if (!dimensionValue) continue;

      for (const column of monthColumns) {
        const qtySold = parsePositiveNumber(row[column.index]);
        if (qtySold === null) continue;
        rows.push({
          dimensionType,
          dimensionValue,
          month: column.month,
          qtySold,
        });
      }
    }
  }

  return { rows };
}

function getMonthlyDimensionType(sheetName: string): MonthlyTrendRow['dimensionType'] | null {
  if (sheetName.startsWith('销量')) return 'project_group';
  if (sheetName.startsWith('品类')) return 'category';
  return null;
}

function getText(row: Record<string, string>, keys: string[]): string {
  const normalizedKeys = new Set(keys.map(normalizeReportKey));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedKeys.has(normalizeReportKey(key)) && value !== undefined && value !== null) {
      return sanitizeCsvText(String(value).trim());
    }
  }
  return '';
}

function normalizeReportKey(value: unknown): string {
  return stringifyCell(value).replace(/^\uFEFF/, '').replace(/\s+/g, '').trim();
}

function parsePositiveNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function stringifyCell(value: unknown): string {
  return value === undefined || value === null ? '' : String(value);
}

function parseMonthHeader(value: unknown): string | null {
  const match = MONTH_HEADER_RE.exec(stringifyCell(value).trim());
  if (!match) return null;

  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  return `${match[1]}-${String(month).padStart(2, '0')}`;
}

function countBy<T>(rows: T[], getKey: (row: T) => string): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const key = getKey(row);
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

/** Parse sales wide-table CSV with original column headers (SKU, (2026-05), etc.). */
export function wideCsvBufferToRowObjects(
  buffer: Buffer | ArrayBuffer | Uint8Array,
): Array<Record<string, string>> {
  const text = decodeCsvBytes(buffer);
  const rows = parseDelimitedText(text);
  if (rows.length < 2) return [];

  const headers = rows[0].map((header) => sanitizeCsvText(header.replace(/^\uFEFF/, '').trim()));
  return rows.slice(1).map((line) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (header) obj[header] = sanitizeCsvText((line[index] ?? '').trim());
    });
    return obj;
  });
}

/** Parse all sheets from a monthly sales workbook xlsx, preserving raw cell values. */
export async function parseXlsxWorkbookBuffer(
  buffer: ArrayBuffer,
): Promise<Record<string, unknown[][]>> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'array' });
  const result: Record<string, unknown[][]> = {};
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    result[name] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][];
  }
  return result;
}
