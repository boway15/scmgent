import { and, eq, inArray, isNotNull, ne, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, skus } from '@scm/db';
import { roundDaily } from './forecast-baseline.js';
import { isForecastV41PlatformCode } from './forecast-platform-scope.js';
import {
  formatForecastMonth,
  normalizeSalesPlatform,
  parseForecastMonth,
} from './forecast-demand.js';
import { assertVersionIsDraft } from './forecast-version.js';
import { wideCsvBufferToRowObjects } from './sales-report-parser.js';

export const DEFAULT_CALIBRATION_IMPORT_REASON = '导入';
export const CALIBRATION_IMPORT_MAX_UPDATES = 50_000;
/** 与导出宽表/校准表 formatDaily(toFixed(2)) 对齐，避免 61.29 vs 61.2934 误判为变更 */
/** @deprecated 与 {@link roundDaily} / {@link FORECAST_DAILY_DECIMALS} 一致，保留别名供文档引用 */
export { FORECAST_DAILY_DECIMALS as CALIBRATION_IMPORT_COMPARE_DECIMALS } from './forecast-baseline.js';
const SAMPLE_LIMIT = 20;

const COL_PERIOD = '时段';
const COL_SKU = 'SKU';
const COL_PLATFORM = '平台';
const COL_MONTH = '绝对月';
const COL_CALIBRATION = '校准值';
const COL_REASON = '调整原因';

const IMPORT_COLUMN_ALIASES: Record<string, string[]> = {
  [COL_PERIOD]: ['period', 'time_period'],
  [COL_SKU]: ['sku', 'sku_code', 'skucode'],
  [COL_PLATFORM]: ['platform', 'channel'],
  [COL_MONTH]: ['month', 'forecast_month', '绝对月份'],
  [COL_CALIBRATION]: ['manual_daily_avg', 'manual', '校准日均'],
  [COL_REASON]: ['adjust_reason', 'reason', '备注'],
};

const MAX_ADJUST_REASON_LEN = 200;

export type CalibrationImportSkipReason = 'empty_calibration' | 'unchanged' | 'ignored_period';

export type CalibrationImportRowError = {
  row: number;
  message: string;
};

export type CalibrationImportUpdatedSample = {
  sku: string;
  platform: string;
  month: string;
  from: number | null;
  to: number;
  adjustReason: string;
};

export type CalibrationImportSkippedSample = {
  sku: string;
  platform: string;
  month: string;
  reason: CalibrationImportSkipReason;
};

export type CalibrationImportResult = {
  versionId: string;
  format: CalibrationImportFormat;
  rowCount: number;
  considered: number;
  updated: number;
  skipped: number;
  errors: number;
  skipBreakdown: {
    empty_calibration: number;
    unchanged: number;
    ignored_period: number;
  };
  samples: {
    updated: CalibrationImportUpdatedSample[];
    skipped: CalibrationImportSkippedSample[];
    errors: CalibrationImportRowError[];
  };
  hasBlockingIssues: boolean;
};

export type CalibrationImportFormat = 'detail' | 'wide';

type ParsedImportRow = {
  rowIndex: number;
  period: string;
  skuCode: string;
  platformLabel: string;
  monthLabel: string;
  calibrationRaw: string;
  adjustReasonRaw: string;
};

const WIDE_FIXED_HEADER_KEYS = new Set(
  [
    'sku',
    'sku名称',
    'sku_name',
    'skuname',
    '平台',
    'platform',
    'channel',
    '生命周期',
    'lifecycle',
    '分层',
    'tier',
    'profile_segment',
    '时段',
    '绝对月',
    '校准值',
    '调整原因',
  ].map((k) => k.toLowerCase()),
);

function isWideFixedColumn(header: string): boolean {
  return WIDE_FIXED_HEADER_KEYS.has(header.trim().toLowerCase());
}

type ExistingForecastCell = {
  id: string;
  forecastDailyAvg: number;
  manualDailyAvg: number | null;
};

export function roundDailyForImportCompare(value: number): number {
  return roundDaily(value);
}

export function dailyImportEquals(a: number, b: number): boolean {
  return roundDaily(a) === roundDaily(b);
}

export function parseCalibrationDaily(raw: string): number | null | 'invalid' {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(value) || value < 0) return 'invalid';
  return roundDaily(value);
}

/** 解析导出明细中的平台列；全平台不可导入。 */
export function parseCalibrationImportPlatform(
  label: string,
): { platform: string } | { error: 'merged' | 'invalid' } {
  const trimmed = label.trim();
  if (!trimmed || trimmed === '全平台' || trimmed.toUpperCase() === 'ALL') {
    return { error: 'merged' };
  }
  const code = normalizeSalesPlatform(trimmed);
  if (!isForecastV41PlatformCode(code)) {
    return { error: 'invalid' };
  }
  return { platform: code };
}

/** @deprecated 导入统一与系统预测对比，见 shouldApplyCalibrationWideImport */
export function shouldApplyCalibrationImport(input: {
  incoming: number;
  currentManual: number | null;
  systemForecast: number;
}): boolean {
  if (input.currentManual != null && dailyImportEquals(input.incoming, input.currentManual)) {
    return false;
  }
  if (input.currentManual == null && dailyImportEquals(input.incoming, input.systemForecast)) {
    return false;
  }
  return true;
}

/** 导入写入校准：仅当与系统预测不一致时更新 manual + 备注；一致则不碰校准字段 */
export function shouldApplyCalibrationWideImport(input: {
  incoming: number;
  systemForecast: number;
}): boolean {
  return !dailyImportEquals(input.incoming, input.systemForecast);
}

function pickRowValue(row: Record<string, string>, canonical: string): string {
  const candidates = [canonical, ...(IMPORT_COLUMN_ALIASES[canonical] ?? [])];
  for (const key of candidates) {
    if (row[key] != null && row[key] !== '') return row[key];
  }
  const norm = new Set(candidates.map((k) => k.trim().toLowerCase()));
  for (const [k, v] of Object.entries(row)) {
    if (norm.has(k.trim().toLowerCase()) && v !== '') return v;
  }
  return '';
}

/** 兼容 Excel 导出的 ="YYYY-MM" 绝对月单元格 */
export function normalizeImportMonthLabel(raw: string): string {
  let s = raw.trim();
  const excelQuoted = s.match(/^="(\d{4}-\d{1,2})"$/);
  if (excelQuoted) return excelQuoted[1];
  if (s.startsWith('=')) {
    s = s.slice(1).replace(/^"|"$/g, '').trim();
  }
  return s;
}

function normalizeAdjustReason(raw: string): string {
  const t = raw.trim() || DEFAULT_CALIBRATION_IMPORT_REASON;
  return t.length > MAX_ADJUST_REASON_LEN ? t.slice(0, MAX_ADJUST_REASON_LEN) : t;
}

function isFutureImportPeriod(period: string): boolean {
  const p = period.trim();
  if (!p || p === '未来') return true;
  return false;
}

/** 宽表：SKU + 平台 + 至少一列 YYYY-MM；明细：绝对月 + 校准值（或时段） */
export function detectCalibrationImportFormat(
  rows: Array<Record<string, string>>,
): CalibrationImportFormat {
  if (rows.length === 0) return 'detail';
  const headers = Object.keys(rows[0] ?? {});
  const hasAbsMonth = headers.some((h) => {
    const n = h.trim().toLowerCase();
    return n === '绝对月' || n === 'month' || n === 'forecast_month' || n === '绝对月份';
  });
  const hasCalibration = headers.some((h) => {
    const n = h.trim().toLowerCase();
    return n === '校准值' || n === 'manual_daily_avg' || n === 'manual' || n === '校准日均';
  });
  const hasPeriod = headers.some((h) => h.trim() === '时段' || h.trim().toLowerCase() === 'period');
  if (hasAbsMonth && (hasCalibration || hasPeriod)) return 'detail';

  const monthColumns = headers.filter((h) => {
    if (isWideFixedColumn(h)) return false;
    return parseForecastMonth(normalizeImportMonthLabel(h)) != null;
  });
  const hasSku = headers.some((h) => h.trim().toLowerCase() === 'sku' || h.trim() === 'SKU');
  const hasPlatform = headers.some((h) => {
    const n = h.trim().toLowerCase();
    return n === '平台' || n === 'platform' || n === 'channel';
  });
  if (hasSku && hasPlatform && monthColumns.length > 0) return 'wide';

  return 'detail';
}

function parseDetailImportRows(rows: Array<Record<string, string>>): ParsedImportRow[] {
  return rows.map((row, index) => ({
    rowIndex: index + 2,
    period: pickRowValue(row, COL_PERIOD),
    skuCode: pickRowValue(row, COL_SKU).trim(),
    platformLabel: pickRowValue(row, COL_PLATFORM),
    monthLabel: pickRowValue(row, COL_MONTH).trim(),
    calibrationRaw: pickRowValue(row, COL_CALIBRATION),
    adjustReasonRaw: pickRowValue(row, COL_REASON),
  }));
}

function expandWideImportRows(rows: Array<Record<string, string>>): ParsedImportRow[] {
  const out: ParsedImportRow[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    const rowIndex = index + 2;
    const skuCode = pickRowValue(row, COL_SKU).trim();
    const platformLabel = pickRowValue(row, COL_PLATFORM);
    for (const [header, rawValue] of Object.entries(row)) {
      if (isWideFixedColumn(header)) continue;
      const monthLabelNorm = normalizeImportMonthLabel(header);
      if (parseForecastMonth(monthLabelNorm) == null) continue;
      out.push({
        rowIndex,
        period: '未来',
        skuCode,
        platformLabel,
        monthLabel: monthLabelNorm,
        calibrationRaw: rawValue ?? '',
        adjustReasonRaw: '',
      });
    }
  }
  return out;
}

function parseImportRows(rows: Array<Record<string, string>>): ParsedImportRow[] {
  const format = detectCalibrationImportFormat(rows);
  return format === 'wide' ? expandWideImportRows(rows) : parseDetailImportRows(rows);
}

function forecastCellKey(
  skuId: string,
  platform: string,
  year: number,
  month: number,
): string {
  return `${skuId}|${platform}|${year}|${month}`;
}

export function parseCalibrationImportCsvBuffer(buffer: Buffer | ArrayBuffer | Uint8Array): {
  rows: ParsedImportRow[];
  rowCount: number;
  format: CalibrationImportFormat;
} {
  const objects = wideCsvBufferToRowObjects(buffer);
  const format = detectCalibrationImportFormat(objects);
  const rows = parseImportRows(objects);
  return { rows, rowCount: objects.length, format };
}

type PendingUpdate = {
  id: string;
  sku: string;
  platform: string;
  month: string;
  from: number | null;
  to: number;
  adjustReason: string;
};

export async function runForecastCalibrationImport(input: {
  versionId: string;
  csvBuffer: Buffer | ArrayBuffer | Uint8Array;
  commit: boolean;
}): Promise<CalibrationImportResult & { applied?: number }> {
  const { versionId, csvBuffer, commit } = input;
  await assertVersionIsDraft(versionId);

  const { rows, rowCount, format } = parseCalibrationImportCsvBuffer(csvBuffer);
  const result: CalibrationImportResult = {
    versionId,
    format,
    rowCount,
    considered: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    skipBreakdown: { empty_calibration: 0, unchanged: 0, ignored_period: 0 },
    samples: { updated: [], skipped: [], errors: [] },
    hasBlockingIssues: false,
  };

  const futureRows = rows.filter((r) => isFutureImportPeriod(r.period));
  result.skipBreakdown.ignored_period = rows.length - futureRows.length;

  const skuCodes = [...new Set(futureRows.map((r) => r.skuCode).filter(Boolean))];
  const skuRows =
    skuCodes.length === 0
      ? []
      : await db
          .select({ id: skus.id, code: skus.code })
          .from(skus)
          .where(inArray(skus.code, skuCodes));

  const skuIdByCode = new Map(skuRows.map((r) => [r.code, r.id]));
  const skuIds = skuRows.map((r) => r.id);

  const forecastRows =
    skuIds.length === 0
      ? []
      : await db
          .select({
            id: salesForecastMonthly.id,
            skuId: salesForecastMonthly.skuId,
            platform: salesForecastMonthly.platform,
            forecastYear: salesForecastMonthly.forecastYear,
            month: salesForecastMonthly.month,
            forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
            manualDailyAvg: salesForecastMonthly.manualDailyAvg,
          })
          .from(salesForecastMonthly)
          .where(
            and(
              eq(salesForecastMonthly.versionId, versionId),
              inArray(salesForecastMonthly.skuId, skuIds),
            ),
          );

  const existingByKey = new Map<string, ExistingForecastCell>();
  for (const row of forecastRows) {
    const system = Number(row.forecastDailyAvg);
    const manual =
      row.manualDailyAvg != null && row.manualDailyAvg !== ''
        ? Number(row.manualDailyAvg)
        : null;
    existingByKey.set(
      forecastCellKey(row.skuId, row.platform, row.forecastYear, row.month),
      {
        id: row.id,
        forecastDailyAvg: Number.isFinite(system) ? roundDaily(system) : 0,
        manualDailyAvg:
          manual != null && Number.isFinite(manual) && manual >= 0 ? roundDaily(manual) : null,
      },
    );
  }

  const pendingUpdates: PendingUpdate[] = [];
  const seenImportKeys = new Map<string, number>();

  for (const row of futureRows) {
    result.considered += 1;

    if (!row.skuCode) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({ row: row.rowIndex, message: 'SKU 为空' });
      }
      continue;
    }

    const platformParsed = parseCalibrationImportPlatform(row.platformLabel);
    if ('error' in platformParsed) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      const message =
        platformParsed.error === 'merged'
          ? '平台为全平台，请使用「分平台」视图导出后再导入'
          : `无法识别平台：${row.platformLabel || '（空）'}`;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({ row: row.rowIndex, message });
      }
      continue;
    }

    const monthLabelNorm = normalizeImportMonthLabel(row.monthLabel);
    const monthParsed = parseForecastMonth(monthLabelNorm);
    if (!monthParsed) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({
          row: row.rowIndex,
          message: `绝对月格式无效：${row.monthLabel || '（空）'}`,
        });
      }
      continue;
    }

    const calibrationParsed = parseCalibrationDaily(row.calibrationRaw);
    if (calibrationParsed === 'invalid') {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({
          row: row.rowIndex,
          message: `校准值无效：${row.calibrationRaw}`,
        });
      }
      continue;
    }

    if (calibrationParsed === null) {
      result.skipped += 1;
      result.skipBreakdown.empty_calibration += 1;
      if (result.samples.skipped.length < SAMPLE_LIMIT) {
        result.samples.skipped.push({
          sku: row.skuCode,
          platform: platformParsed.platform,
          month: row.monthLabel,
          reason: 'empty_calibration',
        });
      }
      continue;
    }

    const importKey = `${row.skuCode}|${platformParsed.platform}|${monthLabelNorm}`;
    if (seenImportKeys.has(importKey)) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({
          row: row.rowIndex,
          message: `重复数据（与第 ${seenImportKeys.get(importKey)} 行相同 SKU/平台/月份）`,
        });
      }
      continue;
    }
    seenImportKeys.set(importKey, row.rowIndex);

    const skuId = skuIdByCode.get(row.skuCode);
    if (!skuId) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({
          row: row.rowIndex,
          message: `SKU 不存在：${row.skuCode}`,
        });
      }
      continue;
    }

    const existing = existingByKey.get(
      forecastCellKey(skuId, platformParsed.platform, monthParsed.year, monthParsed.month),
    );
    if (!existing) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({
          row: row.rowIndex,
          message: `本版本无预测行：${row.skuCode} / ${platformParsed.platform} / ${row.monthLabel}`,
        });
      }
      continue;
    }

    if (
      !shouldApplyCalibrationWideImport({
        incoming: calibrationParsed,
        systemForecast: existing.forecastDailyAvg,
      })
    ) {
      result.skipped += 1;
      result.skipBreakdown.unchanged += 1;
      if (result.samples.skipped.length < SAMPLE_LIMIT) {
        result.samples.skipped.push({
          sku: row.skuCode,
          platform: platformParsed.platform,
          month: row.monthLabel,
          reason: 'unchanged',
        });
      }
      continue;
    }

    const adjustReason = normalizeAdjustReason(row.adjustReasonRaw);
    const fromManual = existing.manualDailyAvg;

    result.updated += 1;
    existing.manualDailyAvg = calibrationParsed;
    pendingUpdates.push({
      id: existing.id,
      sku: row.skuCode,
      platform: platformParsed.platform,
      month: monthLabelNorm,
      from: fromManual,
      to: calibrationParsed,
      adjustReason,
    });
    if (result.samples.updated.length < SAMPLE_LIMIT) {
      result.samples.updated.push({
        sku: row.skuCode,
        platform: platformParsed.platform,
        month: monthLabelNorm,
        from: fromManual,
        to: calibrationParsed,
        adjustReason,
      });
    }
  }

  if (result.updated > CALIBRATION_IMPORT_MAX_UPDATES) {
    result.hasBlockingIssues = true;
    result.errors += 1;
    result.samples.errors.push({
      row: 0,
      message: `单次导入更新条数超过上限 ${CALIBRATION_IMPORT_MAX_UPDATES}，请拆分文件`,
    });
    return result;
  }

  if (!commit || result.hasBlockingIssues || pendingUpdates.length === 0) {
    return result;
  }

  const now = new Date();
  await db.transaction(async (tx) => {
    for (const patch of pendingUpdates) {
      await tx
        .update(salesForecastMonthly)
        .set({
          manualDailyAvg: String(patch.to),
          adjustReason: patch.adjustReason,
          updatedAt: now,
        })
        .where(eq(salesForecastMonthly.id, patch.id));
    }
  });

  return { ...result, applied: pendingUpdates.length };
}

export type ForecastCalibrationClearSample = {
  sku: string;
  platform: string;
  month: string;
  manualDailyAvg: number;
};

export type ForecastCalibrationClearResult = {
  versionId: string;
  rowsWithManual: number;
  cleared?: number;
  samples: ForecastCalibrationClearSample[];
};

function calibrationClearWhere(versionId: string) {
  return and(
    eq(salesForecastMonthly.versionId, versionId),
    ne(salesForecastMonthly.platform, 'ALL'),
    isNotNull(salesForecastMonthly.manualDailyAvg),
  );
}

/** 清空草稿版本内全部分平台 manual_daily_avg（preview 仅统计，commit 执行 UPDATE） */
export async function clearForecastVersionCalibrations(input: {
  versionId: string;
  commit: boolean;
}): Promise<ForecastCalibrationClearResult> {
  await assertVersionIsDraft(input.versionId);

  const where = calibrationClearWhere(input.versionId);
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(salesForecastMonthly)
    .where(where);
  const rowsWithManual = countRow?.count ?? 0;

  const sampleRows =
    rowsWithManual > 0
      ? await db
          .select({
            skuCode: skus.code,
            platform: salesForecastMonthly.platform,
            forecastYear: salesForecastMonthly.forecastYear,
            month: salesForecastMonthly.month,
            manualDailyAvg: salesForecastMonthly.manualDailyAvg,
          })
          .from(salesForecastMonthly)
          .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
          .where(where)
          .orderBy(skus.code, salesForecastMonthly.platform, salesForecastMonthly.forecastYear, salesForecastMonthly.month)
          .limit(SAMPLE_LIMIT)
      : [];

  const samples: ForecastCalibrationClearSample[] = sampleRows.map((row) => ({
    sku: row.skuCode,
    platform: normalizeSalesPlatform(row.platform),
    month: formatForecastMonth(row.forecastYear, row.month),
    manualDailyAvg: roundDaily(Number(row.manualDailyAvg)),
  }));

  if (!input.commit) {
    return {
      versionId: input.versionId,
      rowsWithManual,
      samples,
    };
  }

  if (rowsWithManual === 0) {
    return {
      versionId: input.versionId,
      rowsWithManual: 0,
      cleared: 0,
      samples: [],
    };
  }

  const now = new Date();
  await db
    .update(salesForecastMonthly)
    .set({
      manualDailyAvg: null,
      adjustReason: null,
      updatedAt: now,
    })
    .where(where);

  return {
    versionId: input.versionId,
    rowsWithManual,
    cleared: rowsWithManual,
    samples,
  };
}
