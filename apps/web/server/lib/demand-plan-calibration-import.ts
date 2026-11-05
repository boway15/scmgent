import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db, demandPlanVersions, demandPlanWeekly, skus } from '@scm/db';
import { roundDaily } from './forecast-baseline.js';
import {
  dailyImportEquals,
  DEFAULT_CALIBRATION_IMPORT_REASON,
  parseCalibrationDaily,
  parseCalibrationImportPlatform,
  shouldApplyCalibrationWideImport,
  type CalibrationImportFormat,
  type CalibrationImportResult,
} from './forecast-calibration-import.js';
import { splitMergedWeeklyDailyByPlatform } from './demand-plan-enrich.js';
import { loadPublishedForecastSkuMetaBySkuIds } from './forecast-published-resolve.js';
import { isIsoWeekPeriod } from './planning-calendar.js';
import { wideCsvBufferToRowObjects } from './sales-report-parser.js';

export const DEMAND_PLAN_CALIBRATION_IMPORT_MAX_UPDATES = 50_000;
const SAMPLE_LIMIT = 20;
const MAX_ADJUST_REASON_LEN = 200;

const COL_PERIOD = '时段';
const COL_SKU = 'SKU';
const COL_PLATFORM = '平台';
const COL_WEEK = '绝对周';
const COL_CALIBRATION = '校准值';
const COL_REASON = '调整原因';

const IMPORT_COLUMN_ALIASES: Record<string, string[]> = {
  [COL_PERIOD]: ['period', 'time_period'],
  [COL_SKU]: ['sku', 'sku_code', 'skucode'],
  [COL_PLATFORM]: ['platform', 'channel'],
  [COL_WEEK]: ['week', 'iso_week', 'period_week', '绝对周次'],
  [COL_CALIBRATION]: ['manual_daily_avg', 'manual', '校准日均'],
  [COL_REASON]: ['adjust_reason', 'reason', '备注'],
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
    '绝对周',
    '校准值',
    '调整原因',
  ].map((k) => k.toLowerCase()),
);

type ParsedImportRow = {
  rowIndex: number;
  period: string;
  skuCode: string;
  platformLabel: string;
  weekKey: string;
  calibrationRaw: string;
  adjustReasonRaw: string;
};

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

function isWideFixedColumn(header: string): boolean {
  return WIDE_FIXED_HEADER_KEYS.has(header.trim().toLowerCase());
}

function normalizeWeekKey(raw: string): string | null {
  let s = raw.trim();
  const head = s.match(/^(\d{4}-W\d{2})/);
  if (head) return head[1]!;
  if (isIsoWeekPeriod(s)) return s;
  return null;
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

export function detectDemandPlanCalibrationImportFormat(
  rows: Array<Record<string, string>>,
): CalibrationImportFormat {
  if (rows.length === 0) return 'detail';
  const headers = Object.keys(rows[0] ?? {});
  const hasAbsWeek = headers.some((h) => {
    const n = h.trim().toLowerCase();
    return n === '绝对周' || n === 'week' || n === 'iso_week';
  });
  const hasCalibration = headers.some((h) => {
    const n = h.trim().toLowerCase();
    return n === '校准值' || n === 'manual_daily_avg' || n === 'manual' || n === '校准日均';
  });
  const hasPeriod = headers.some((h) => h.trim() === '时段' || h.trim().toLowerCase() === 'period');
  if (hasAbsWeek && (hasCalibration || hasPeriod)) return 'detail';

  const weekColumns = headers.filter((h) => {
    if (isWideFixedColumn(h)) return false;
    return normalizeWeekKey(h) != null;
  });
  const hasSku = headers.some((h) => h.trim().toLowerCase() === 'sku' || h.trim() === 'SKU');
  const hasPlatform = headers.some((h) => {
    const n = h.trim().toLowerCase();
    return n === '平台' || n === 'platform' || n === 'channel';
  });
  if (hasSku && hasPlatform && weekColumns.length > 0) return 'wide';
  return 'detail';
}

function parseDetailImportRows(rows: Array<Record<string, string>>): ParsedImportRow[] {
  return rows.map((row, index) => ({
    rowIndex: index + 2,
    period: pickRowValue(row, COL_PERIOD),
    skuCode: pickRowValue(row, COL_SKU).trim(),
    platformLabel: pickRowValue(row, COL_PLATFORM),
    weekKey: pickRowValue(row, COL_WEEK).trim(),
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
      const weekKey = normalizeWeekKey(header);
      if (!weekKey) continue;
      out.push({
        rowIndex,
        period: '未来',
        skuCode,
        platformLabel,
        weekKey,
        calibrationRaw: rawValue ?? '',
        adjustReasonRaw: '',
      });
    }
  }
  return out;
}

export function parseDemandPlanCalibrationImportCsvBuffer(buffer: Buffer | ArrayBuffer | Uint8Array): {
  rows: ParsedImportRow[];
  rowCount: number;
  format: CalibrationImportFormat;
} {
  const objects = wideCsvBufferToRowObjects(buffer);
  const format = detectDemandPlanCalibrationImportFormat(objects);
  const rows = format === 'wide' ? expandWideImportRows(objects) : parseDetailImportRows(objects);
  return { rows, rowCount: objects.length, format };
}

async function assertDemandPlanVersionIsDraft(versionId: string): Promise<void> {
  const [version] = await db
    .select({ status: demandPlanVersions.status })
    .from(demandPlanVersions)
    .where(eq(demandPlanVersions.id, versionId))
    .limit(1);
  if (!version) {
    throw Object.assign(new Error('需求计划版本不存在'), { status: 404 });
  }
  if (version.status !== 'draft') {
    throw Object.assign(new Error('仅草稿版本可导入校准'), { status: 400 });
  }
}

type ExistingWeeklyCell = {
  id: string;
  systemDailyAvg: number;
  manualDailyAvg: number | null;
  adjustReason: string | null;
};

type ParsedCell = {
  rowIndex: number;
  skuCode: string;
  platform: string | 'ALL';
  weekKey: string;
  calibration: number;
  adjustReason: string;
};

function parsePlatformLabel(label: string): { platform: string | 'ALL' } | { error: string } {
  const trimmed = label.trim();
  if (!trimmed || trimmed === '全平台' || trimmed.toUpperCase() === 'ALL') {
    return { platform: 'ALL' };
  }
  const parsed = parseCalibrationImportPlatform(label);
  if ('error' in parsed) {
    return { error: `无法识别平台：${label || '（空）'}` };
  }
  return { platform: parsed.platform };
}

function mergePlatformCalibrations(input: {
  platformCals: Array<{ platform: string; calibration: number }>;
  mergedSystem: number;
  weekKey: string;
  monthByPlatform: Map<string, Map<string, number>>;
}): number {
  const split = splitMergedWeeklyDailyByPlatform({
    period: input.weekKey,
    mergedSystemDaily: input.mergedSystem,
    mergedManualDaily: null,
    monthByPlatform: input.monthByPlatform,
    platforms: input.platformCals.map((row) => row.platform),
  });
  let weightSum = 0;
  let weighted = 0;
  for (const row of input.platformCals) {
    const breakdown = split.breakdown.find((item) => item.platform === row.platform);
    const weight = breakdown?.systemDailyAvg ?? 0;
    const w = Math.max(0, weight);
    weightSum += w;
    weighted += row.calibration * w;
  }
  if (weightSum <= 0) {
    const avg = input.platformCals.reduce((sum, row) => sum + row.calibration, 0) / input.platformCals.length;
    return roundDaily(avg);
  }
  return roundDaily(weighted / weightSum);
}

export async function runDemandPlanCalibrationImport(input: {
  versionId: string;
  csvBuffer: Buffer | ArrayBuffer | Uint8Array;
  commit: boolean;
}): Promise<CalibrationImportResult & { applied?: number }> {
  const { versionId, csvBuffer, commit } = input;
  await assertDemandPlanVersionIsDraft(versionId);

  const { rows, rowCount, format } = parseDemandPlanCalibrationImportCsvBuffer(csvBuffer);
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

  const parsedCells: ParsedCell[] = [];

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
    const platformParsed = parsePlatformLabel(row.platformLabel);
    if ('error' in platformParsed) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({ row: row.rowIndex, message: platformParsed.error });
      }
      continue;
    }
    const weekKey = normalizeWeekKey(row.weekKey);
    if (!weekKey) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({
          row: row.rowIndex,
          message: `绝对周格式无效：${row.weekKey || '（空）'}`,
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
          platform: platformParsed.platform === 'ALL' ? 'ALL' : platformParsed.platform,
          month: weekKey,
          reason: 'empty_calibration',
        });
      }
      continue;
    }
    parsedCells.push({
      rowIndex: row.rowIndex,
      skuCode: row.skuCode,
      platform: platformParsed.platform,
      weekKey,
      calibration: calibrationParsed,
      adjustReason: normalizeAdjustReason(row.adjustReasonRaw),
    });
  }

  const skuCodes = [...new Set(parsedCells.map((r) => r.skuCode))];
  const skuRows =
    skuCodes.length === 0
      ? []
      : await db
          .select({ id: skus.id, code: skus.code })
          .from(skus)
          .where(inArray(skus.code, skuCodes));
  const skuIdByCode = new Map(skuRows.map((r) => [r.code, r.id]));
  const skuIds = skuRows.map((r) => r.id);
  const metaBySku = await loadPublishedForecastSkuMetaBySkuIds(skuIds);

  const weeklyRows =
    skuIds.length === 0
      ? []
      : await db
          .select({
            id: demandPlanWeekly.id,
            skuId: demandPlanWeekly.skuId,
            period: demandPlanWeekly.period,
            systemDailyAvg: demandPlanWeekly.systemDailyAvg,
            manualDailyAvg: demandPlanWeekly.manualDailyAvg,
            adjustReason: demandPlanWeekly.adjustReason,
          })
          .from(demandPlanWeekly)
          .where(and(eq(demandPlanWeekly.versionId, versionId), inArray(demandPlanWeekly.skuId, skuIds)));

  const existingByKey = new Map<string, ExistingWeeklyCell>();
  for (const row of weeklyRows) {
    const system = Number(row.systemDailyAvg);
    const manual =
      row.manualDailyAvg != null && row.manualDailyAvg !== ''
        ? Number(row.manualDailyAvg)
        : null;
    existingByKey.set(`${row.skuId}|${row.period}`, {
      id: row.id,
      systemDailyAvg: Number.isFinite(system) ? roundDaily(system) : 0,
      manualDailyAvg:
        manual != null && Number.isFinite(manual) && manual >= 0 ? roundDaily(manual) : null,
      adjustReason: row.adjustReason,
    });
  }

  type GroupKey = string;
  const groups = new Map<
    GroupKey,
    {
      merged?: ParsedCell;
      platforms: ParsedCell[];
      rowIndexes: number[];
    }
  >();

  for (const cell of parsedCells) {
    const key = `${cell.skuCode}|${cell.weekKey}`;
    const group = groups.get(key) ?? { platforms: [], rowIndexes: [] };
    if (cell.platform === 'ALL') {
      if (group.merged) {
        result.errors += 1;
        result.hasBlockingIssues = true;
        if (result.samples.errors.length < SAMPLE_LIMIT) {
          result.samples.errors.push({
            row: cell.rowIndex,
            message: `重复合计行（SKU/周 ${cell.skuCode}/${cell.weekKey}）`,
          });
        }
        continue;
      }
      group.merged = cell;
    } else {
      group.platforms.push(cell);
    }
    group.rowIndexes.push(cell.rowIndex);
    groups.set(key, group);
  }

  const pendingUpdates: Array<{
    id: string;
    sku: string;
    weekKey: string;
    from: number | null;
    to: number;
    adjustReason: string;
  }> = [];

  for (const [groupKey, group] of groups) {
    const [skuCode, weekKey] = groupKey.split('|');
    const skuId = skuIdByCode.get(skuCode ?? '');
    if (!skuId) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({
          row: group.rowIndexes[0] ?? 0,
          message: `SKU 不存在：${skuCode}`,
        });
      }
      continue;
    }
    const existing = existingByKey.get(`${skuId}|${weekKey}`);
    if (!existing) {
      result.errors += 1;
      result.hasBlockingIssues = true;
      if (result.samples.errors.length < SAMPLE_LIMIT) {
        result.samples.errors.push({
          row: group.rowIndexes[0] ?? 0,
          message: `本版本无计划行：${skuCode} / ${weekKey}`,
        });
      }
      continue;
    }

    let targetManual: number;
    let adjustReason: string;

    if (group.merged) {
      targetManual = group.merged.calibration;
      adjustReason = group.merged.adjustReason;
      if (group.platforms.length > 0) {
        result.errors += 1;
        result.hasBlockingIssues = true;
        if (result.samples.errors.length < SAMPLE_LIMIT) {
          result.samples.errors.push({
            row: group.merged.rowIndex,
            message: `同一 SKU/周不可同时导入合计与分平台：${skuCode} / ${weekKey}`,
          });
        }
        continue;
      }
    } else {
      const meta = metaBySku.get(skuId);
      targetManual = mergePlatformCalibrations({
        platformCals: group.platforms.map((row) => ({
          platform: row.platform as string,
          calibration: row.calibration,
        })),
        mergedSystem: existing.systemDailyAvg,
        weekKey: weekKey ?? '',
        monthByPlatform: meta?.monthByPlatform ?? new Map(),
      });
      adjustReason =
        group.platforms.find((row) => row.adjustReason.trim() !== DEFAULT_CALIBRATION_IMPORT_REASON)
          ?.adjustReason ?? DEFAULT_CALIBRATION_IMPORT_REASON;
    }

    if (
      !shouldApplyCalibrationWideImport({
        incoming: targetManual,
        systemForecast: existing.systemDailyAvg,
      })
    ) {
      result.skipped += 1;
      result.skipBreakdown.unchanged += 1;
      if (result.samples.skipped.length < SAMPLE_LIMIT) {
        result.samples.skipped.push({
          sku: skuCode ?? '',
          platform: 'ALL',
          month: weekKey ?? '',
          reason: 'unchanged',
        });
      }
      continue;
    }

    if (existing.manualDailyAvg != null && dailyImportEquals(targetManual, existing.manualDailyAvg)) {
      result.skipped += 1;
      result.skipBreakdown.unchanged += 1;
      continue;
    }

    result.updated += 1;
    const fromManual = existing.manualDailyAvg;
    existing.manualDailyAvg = targetManual;
    pendingUpdates.push({
      id: existing.id,
      sku: skuCode ?? '',
      weekKey: weekKey ?? '',
      from: fromManual,
      to: targetManual,
      adjustReason,
    });
    if (result.samples.updated.length < SAMPLE_LIMIT) {
      result.samples.updated.push({
        sku: skuCode ?? '',
        platform: 'ALL',
        month: weekKey ?? '',
        from: fromManual,
        to: targetManual,
        adjustReason,
      });
    }
  }

  if (result.updated > DEMAND_PLAN_CALIBRATION_IMPORT_MAX_UPDATES) {
    result.hasBlockingIssues = true;
    result.errors += 1;
    result.samples.errors.push({
      row: 0,
      message: `单次导入更新条数超过上限 ${DEMAND_PLAN_CALIBRATION_IMPORT_MAX_UPDATES}，请拆分文件`,
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
        .update(demandPlanWeekly)
        .set({
          manualDailyAvg: String(patch.to),
          adjustReason: patch.adjustReason,
          updatedAt: now,
        })
        .where(eq(demandPlanWeekly.id, patch.id));
    }
  });

  return { ...result, applied: pendingUpdates.length };
}

export type DemandPlanCalibrationClearResult = {
  versionId: string;
  rowsWithManual: number;
  cleared?: number;
  samples: Array<{ sku: string; weekKey: string; manualDailyAvg: number }>;
};

export async function clearDemandPlanVersionCalibrations(input: {
  versionId: string;
  commit: boolean;
}): Promise<DemandPlanCalibrationClearResult> {
  await assertDemandPlanVersionIsDraft(input.versionId);
  const where = and(
    eq(demandPlanWeekly.versionId, input.versionId),
    isNotNull(demandPlanWeekly.manualDailyAvg),
  );
  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(demandPlanWeekly)
    .where(where);
  const rowsWithManual = countRow?.count ?? 0;

  const sampleRows =
    rowsWithManual > 0
      ? await db
          .select({
            skuCode: skus.code,
            period: demandPlanWeekly.period,
            manualDailyAvg: demandPlanWeekly.manualDailyAvg,
          })
          .from(demandPlanWeekly)
          .innerJoin(skus, eq(skus.id, demandPlanWeekly.skuId))
          .where(where)
          .orderBy(skus.code, demandPlanWeekly.period)
          .limit(SAMPLE_LIMIT)
      : [];

  const samples = sampleRows.map((row) => ({
    sku: row.skuCode,
    weekKey: row.period,
    manualDailyAvg: Number(row.manualDailyAvg),
  }));

  if (!input.commit || rowsWithManual === 0) {
    return { versionId: input.versionId, rowsWithManual, samples };
  }

  const now = new Date();
  await db
    .update(demandPlanWeekly)
    .set({ manualDailyAvg: null, adjustReason: null, updatedAt: now })
    .where(where);

  return {
    versionId: input.versionId,
    rowsWithManual,
    cleared: rowsWithManual,
    samples,
  };
}
