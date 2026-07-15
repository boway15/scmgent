import { and, asc, eq, ilike, inArray, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, skus } from '@scm/db';
import {
  buildMonthlyForecastHorizon,
  clipCombinedSeasonality,
  parseHorizonFactors,
  type HorizonFactorSnapshot,
} from './forecast-baseline.js';
import {
  ALLCAT_V41_MODEL,
  parseAllCatV41HorizonFactors,
  type AllCatV41HorizonDisplay,
} from './forecast-allcat-v41.js';
import { formatForecastMonth, mapForecastDailyFields, normalizeSalesPlatform, aggregateForecastRows, sumEffectiveForecastDailyAcrossPlatforms } from './forecast-demand.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import {
  FORECAST_GLOBAL_STATION,
  normalizeForecastStation,
} from './forecast-station-scope.js';
import { loadSeasonalityLookup, resolveSeasonalityFactors } from './forecast-collaboration.js';
import { getForecastVersionById } from './forecast-version.js';
import { categoryMatchesFilterCondition } from './sku-category.js';
import { loadMonthlySalesBySkuIds } from './sales-history-query.js';
import { MAX_FORECAST_MONTH_COUNT } from './forecast-limits.js';

const ALLCAT_V41_PROFILE_SEGMENTS = new Set(['T1', 'T2', 'T3', 'T3P', 'T4A', 'T4B', 'T99']);

/** AI 辅助标记，不是商品分层；展示与筛选时应忽略 */
export function isPersistedProfileSegment(segment: string | null | undefined): boolean {
  const normalized = segment?.trim().toUpperCase();
  return Boolean(normalized && normalized !== 'AI');
}

/** 列表筛选生效的分层（待校准 ≡ T99） */
export function resolveHorizonProfileSegmentFilter(input: {
  profileSegment?: string;
  pendingCalibration?: boolean;
}): string | null {
  if (input.pendingCalibration) return 'T99';
  const segment = input.profileSegment?.trim().toUpperCase();
  if (segment && ALLCAT_V41_PROFILE_SEGMENTS.has(segment)) return segment;
  return null;
}

type ForecastMonthRef = { forecastYear: number; month: number };

type TierPickableRow = ForecastMonthRef & {
  platform: string;
  profileSegment: string | null;
};

/** 预测版本内首月（触发时分层锚点） */
export function findFirstForecastMonth(rows: ForecastMonthRef[]): ForecastMonthRef | null {
  if (!rows.length) return null;
  const found = rows.reduce<ForecastMonthRef>(
    (min, row) =>
      row.forecastYear < min.forecastYear ||
      (row.forecastYear === min.forecastYear && row.month < min.month)
        ? row
        : min,
    rows[0]!,
  );
  return { forecastYear: found.forecastYear, month: found.month };
}

function isSameForecastMonth(a: ForecastMonthRef, b: ForecastMonthRef): boolean {
  return a.forecastYear === b.forecastYear && a.month === b.month;
}

/** 与 PRIMARY_TIER_PICK_ORDER_SQL 一致：非 T99 优先 → AMAZON 优先 → platform 字典序 */
export function comparePrimaryTierPickOrder(a: TierPickableRow, b: TierPickableRow): number {
  const rank = (row: TierPickableRow): [number, number, string] => {
    const segment = row.profileSegment?.trim().toUpperCase() ?? '';
    const nonT99Rank = isPersistedProfileSegment(segment) && segment !== 'T99' ? 0 : 1;
    const amazonRank = normalizeSalesPlatform(row.platform) === 'AMAZON' ? 0 : 1;
    return [nonT99Rank, amazonRank, normalizeSalesPlatform(row.platform)];
  };
  const [a0, a1, a2] = rank(a);
  const [b0, b1, b2] = rank(b);
  if (a0 !== b0) return a0 - b0;
  if (a1 !== b1) return a1 - b1;
  return a2.localeCompare(b2);
}

export function pickPrimaryTierRow<T extends TierPickableRow>(rows: T[]): T | null {
  if (!rows.length) return null;
  return [...rows].sort(comparePrimaryTierPickOrder)[0]!;
}

/** 与 pickPrimaryTierRow 一致：仅非空且非 T99 优先，其次 AMAZON */
const PRIMARY_TIER_PICK_ORDER_SQL = sql`
  CASE
    WHEN profile_segment IS NOT NULL AND profile_segment NOT IN ('T99', 'AI') THEN 0
    ELSE 1
  END,
  CASE WHEN platform = 'AMAZON' THEN 0 ELSE 1 END
`;

const earlierThanSfmSql = sql`(
  earlier.forecast_year < sfm.forecast_year
  OR (earlier.forecast_year = sfm.forecast_year AND earlier.month < sfm.month)
)`;

const v41PlatformCodesSql = sql.join(
  FORECAST_V41_PLATFORM_CODES.map((code) => sql`${code}`),
  sql`, `,
);

/**
 * 全渠道汇总：按触发月锚点分层筛 SKU（单次查询，避免关联子查询拖垮连接池）。
 * 无分层筛选时返回 null；有筛选但无匹配时返回 []。
 */
async function loadAnchorTierFilteredSkuIds(input: {
  versionId: string;
  stationFilter: string;
  profileSegment?: string;
  pendingCalibration?: boolean;
}): Promise<string[] | null> {
  const segment = input.pendingCalibration
    ? 'T99'
    : input.profileSegment?.trim().toUpperCase();
  if (!segment || !ALLCAT_V41_PROFILE_SEGMENTS.has(segment)) return null;

  const pendingClause = input.pendingCalibration
    ? sql`AND NOT EXISTS (
        SELECT 1 FROM ${salesForecastMonthly} cal
        WHERE cal.version_id = ${input.versionId}
          AND cal.sku_id = picked.sku_id
          AND cal.station = ${input.stationFilter}
          AND cal.manual_daily_avg IS NOT NULL
      )`
    : sql``;

  const result = await db.execute<{ sku_id: string }>(sql`
    SELECT picked.sku_id
    FROM (
      SELECT DISTINCT ON (sfm.sku_id)
        sfm.sku_id,
        sfm.profile_segment
      FROM ${salesForecastMonthly} sfm
      WHERE sfm.version_id = ${input.versionId}
        AND sfm.station = ${input.stationFilter}
        AND sfm.platform IN (${v41PlatformCodesSql})
        AND NOT EXISTS (
          SELECT 1 FROM ${salesForecastMonthly} earlier
          WHERE earlier.version_id = sfm.version_id
            AND earlier.sku_id = sfm.sku_id
            AND earlier.station = sfm.station
            AND earlier.platform = sfm.platform
            AND ${earlierThanSfmSql}
        )
      ORDER BY sfm.sku_id, ${PRIMARY_TIER_PICK_ORDER_SQL}
    ) picked
    WHERE UPPER(picked.profile_segment) = ${segment}
    ${pendingClause}
  `);

  return Array.from(result as Iterable<{ sku_id: string }>).map((row) => row.sku_id);
}

/** 触发时分层：首月 + 主渠道优先（非 T99 优先 AMAZON） */
export function resolveAnchorProfileSegment(rows: TierPickableRow[]): string | null {
  const firstMonth = findFirstForecastMonth(rows);
  if (!firstMonth) return null;
  const anchorRows = rows.filter((row) => isSameForecastMonth(row, firstMonth));
  return pickPrimaryTierRow(anchorRows)?.profileSegment ?? null;
}

function appendHorizonPlatformTierFilter(
  conditions: Parameters<typeof and>,
  input: {
    versionId: string;
    profileSegment?: string;
    pendingCalibration?: boolean;
  },
) {
  const segment = input.pendingCalibration
    ? 'T99'
    : input.profileSegment?.trim().toUpperCase();
  if (!segment || !ALLCAT_V41_PROFILE_SEGMENTS.has(segment)) return;

  const earlierThanAnchor = sql`(
    earlier.forecast_year < anchor.forecast_year
    OR (earlier.forecast_year = anchor.forecast_year AND earlier.month < anchor.month)
  )`;

  conditions.push(
    sql`EXISTS (
      SELECT 1 FROM ${salesForecastMonthly} anchor
      WHERE anchor.version_id = ${input.versionId}
        AND anchor.sku_id = ${salesForecastMonthly.skuId}
        AND anchor.station = ${salesForecastMonthly.station}
        AND anchor.platform = ${salesForecastMonthly.platform}
        AND UPPER(anchor.profile_segment) = ${segment}
        AND NOT EXISTS (
          SELECT 1 FROM ${salesForecastMonthly} earlier
          WHERE earlier.version_id = anchor.version_id
            AND earlier.sku_id = anchor.sku_id
            AND earlier.station = anchor.station
            AND earlier.platform = anchor.platform
            AND ${earlierThanAnchor}
        )
    )`,
  );

  if (input.pendingCalibration) {
    conditions.push(
      sql`NOT EXISTS (
        SELECT 1 FROM sales_forecast_monthly cal
        WHERE cal.version_id = ${input.versionId}
          AND cal.sku_id = ${salesForecastMonthly.skuId}
          AND cal.station = ${salesForecastMonthly.station}
          AND cal.platform = ${salesForecastMonthly.platform}
          AND cal.manual_daily_avg IS NOT NULL
      )`,
    );
  }
}

export type ForecastHorizonMonth = {
  forecastYear: number;
  month: number;
  monthLabel: string;
};

export type ForecastHorizonCell = {
  id: string;
  forecastYear: number;
  month: number;
  monthLabel: string;
  /** 系统算法预测日均（重新生成会更新） */
  forecastDailyAvg: number;
  /** 运营校准日均；有值时下游与矩阵展示优先使用 */
  manualDailyAvg: number | null;
  /** 生效日均 = manualDailyAvg ?? forecastDailyAvg */
  effectiveDailyAvg: number;
  adjustReason: string | null;
  baselineDailyAvg: number | null;
  lifecycle: string | null;
  confidenceLevel: string | null;
  skuTrendFactor: number | null;
  seasonalityFactor: number;
  trendFactor: number;
  categoryCombinedFactor: number;
  categoryTrendWasClipped: boolean;
  categoryTrendMatched: boolean;
  horizonFactors: HorizonFactorSnapshot | null;
  /** V4.1 KPI 分层因子（与 legacy horizonFactors 互斥） */
  allCatV41Factors: AllCatV41HorizonDisplay | null;
  forecastModel: string | null;
  /** Dify AI 辅助预测写入的逐月分析说明 */
  aiAssistRationale?: string | null;
  /** AI 辅助模式：auto | human */
  aiAssistMode?: 'auto' | 'human' | null;
};

export type ForecastHistoryCell = {
  forecastYear: number;
  month: number;
  monthLabel: string;
  qtySold: number;
  actualDailyAvg: number;
};

export type ForecastHorizonRow = {
  skuId: string;
  skuCode: string;
  skuName: string;
  category: string | null;
  station: string;
  platform: string;
  lifecycle: string | null;
  forecastProfileClass: string | null;
  profileSegment: string | null;
  months: ForecastHorizonCell[];
  historyMonths: ForecastHistoryCell[];
};

export type ForecastHorizonResult = {
  horizon: ForecastHorizonMonth[];
  historyHorizon: ForecastHorizonMonth[];
  items: ForecastHorizonRow[];
  total: number;
  page: number;
  pageSize: number;
  version: {
    id: string;
    versionName: string;
    status: string;
    station: string | null;
  } | null;
};

type ForecastIdentity = {
  skuId: string;
  skuCode: string;
  skuName: string;
  category: string | null;
  station: string;
  platform: string;
};

function numericOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function deriveSkuTrendFactor(input: {
  forecastDailyAvg: number;
  baselineDailyAvg: number | null;
  categoryCombinedFactor: number;
}): number | null {
  const baseline = input.baselineDailyAvg ?? 0;
  const category = input.categoryCombinedFactor || 1;
  const denominator = baseline * category;
  if (denominator <= 0) return null;
  return Math.round((input.forecastDailyAvg / denominator) * 10_000) / 10_000;
}

function buildCategoryFactors(
  lookup: Awaited<ReturnType<typeof loadSeasonalityLookup>>,
  category: string | null | undefined,
  calendarMonth: number,
) {
  const resolved = resolveSeasonalityFactors(lookup, category, calendarMonth);
  const rawCombined = resolved.seasonalityFactor * resolved.trendFactor;
  const clipped = clipCombinedSeasonality(rawCombined);
  return {
    seasonalityFactor: resolved.seasonalityFactor,
    trendFactor: resolved.trendFactor,
    categoryCombinedFactor: clipped.factor,
    categoryTrendWasClipped: clipped.wasClipped,
    categoryTrendMatched: resolved.matched,
  };
}

function daysInCalendarMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 历史绝对月标签（不含 asOf 当月，从上月回溯） */
export function buildHistoryMonthLabels(monthCount: number, asOf = new Date()): ForecastHorizonMonth[] {
  const safeCount = Math.max(0, Math.floor(monthCount));
  if (safeCount === 0) return [];

  const labels: ForecastHorizonMonth[] = [];
  let y = asOf.getUTCFullYear();
  let m = asOf.getUTCMonth() + 1;
  m -= 1;
  if (m < 1) {
    m = 12;
    y -= 1;
  }

  for (let index = 0; index < safeCount; index++) {
    labels.unshift({
      forecastYear: y,
      month: m,
      monthLabel: formatForecastMonth(y, m),
    });
    m -= 1;
    if (m < 1) {
      m = 12;
      y -= 1;
    }
  }

  return labels;
}

function buildHistoryCellsForSku(
  historyHorizon: ForecastHorizonMonth[],
  qtyByMonthLabel: Map<string, number>,
): ForecastHistoryCell[] {
  return historyHorizon.map((h) => {
    const qtySold = qtyByMonthLabel.get(h.monthLabel) ?? 0;
    const days = daysInCalendarMonth(h.forecastYear, h.month);
    const actualDailyAvg = days > 0 ? Math.round((qtySold / days) * 100) / 100 : 0;
    return {
      forecastYear: h.forecastYear,
      month: h.month,
      monthLabel: h.monthLabel,
      qtySold,
      actualDailyAvg,
    };
  });
}

async function loadHistoryQtyBySkuPlatform(input: {
  identities: ForecastIdentity[];
  historyHorizon: ForecastHorizonMonth[];
}): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (!input.historyHorizon.length || !input.identities.length) return result;

  const first = input.historyHorizon[0]!;
  const skuIdsByPlatform = new Map<string, string[]>();

  for (const identity of input.identities) {
    const platform = normalizeSalesPlatform(identity.platform);
    const list = skuIdsByPlatform.get(platform) ?? [];
    if (!list.includes(identity.skuId)) list.push(identity.skuId);
    skuIdsByPlatform.set(platform, list);
  }

  for (const [platform, skuIds] of skuIdsByPlatform) {
    const monthlyBySku = await loadMonthlySalesBySkuIds({
      skuIds,
      platform,
      minYear: first.forecastYear,
      minMonth: first.month,
    });

    for (const [skuId, rows] of monthlyBySku) {
      const key = `${platform}::${skuId}`;
      const byMonth = result.get(key) ?? new Map<string, number>();
      for (const row of rows) {
        const label = formatForecastMonth(row.saleYear, row.month);
        byMonth.set(label, (byMonth.get(label) ?? 0) + row.qtySold);
      }
      result.set(key, byMonth);
    }
  }

  return result;
}

function buildHorizonLabels(rows: Array<{ forecastYear: number; month: number }>): ForecastHorizonMonth[] {
  const seen = new Set<string>();
  const labels: ForecastHorizonMonth[] = [];
  for (const row of rows) {
    const monthLabel = formatForecastMonth(row.forecastYear, row.month);
    if (seen.has(monthLabel)) continue;
    seen.add(monthLabel);
    labels.push({ forecastYear: row.forecastYear, month: row.month, monthLabel });
  }
  labels.sort((a, b) => a.monthLabel.localeCompare(b.monthLabel));
  return labels;
}

export function buildConfiguredHorizonLabels(monthCount: number, asOf = new Date()): ForecastHorizonMonth[] {
  return buildMonthlyForecastHorizon(asOf, monthCount).map((h) => ({
    forecastYear: h.forecastYear,
    month: h.month,
    monthLabel: formatForecastMonth(h.forecastYear, h.month),
  }));
}

function exogenousReasonShort(reason: unknown): string {
  switch (reason) {
    case 'ad':
      return '投广告';
    case 'price_change':
      return '调价';
    case 'promo':
      return '促销';
    case 'listing_change':
      return '上架变更';
    default:
      return '外生';
  }
}

function formatExogenousTooltip(exogenous: unknown): string | null {
  if (!exogenous || typeof exogenous !== 'object') return null;
  const value = exogenous as Record<string, unknown>;
  const factors = Array.isArray(value.factors) ? value.factors : [];
  const parts: string[] = [];
  for (const item of factors) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const monthLabel = String(row.monthLabel ?? '').trim();
    if (!monthLabel) continue;
    const reason = exogenousReasonShort(row.reason);
    const intensity =
      row.intensity != null && row.intensity !== '' ? String(row.intensity) : '';
    parts.push(
      intensity ? `${monthLabel} ${reason} ${intensity}` : `${monthLabel} ${reason}`,
    );
  }
  const operatorNote =
    typeof value.operatorNote === 'string' && value.operatorNote.trim()
      ? value.operatorNote.trim()
      : '';
  if (operatorNote) parts.push(`说明：${operatorNote}`);
  return parts.length ? `人工外生：${parts.join('；')}` : null;
}

function parseAiAssistMeta(raw: unknown): {
  rationale: string | null;
  assistMode: 'auto' | 'human' | null;
  tooltip: string | null;
} {
  if (!raw || typeof raw !== 'object') {
    return { rationale: null, assistMode: null, tooltip: null };
  }
  const value = raw as Record<string, unknown>;
  if (value.source !== 'ai_assist') {
    return { rationale: null, assistMode: null, tooltip: null };
  }
  const rationale =
    typeof value.rationale === 'string' && value.rationale.trim()
      ? value.rationale.trim()
      : null;
  const assistMode = value.assistMode === 'human' ? 'human' : value.assistMode === 'auto' ? 'auto' : null;
  const exogenousPrefix = assistMode === 'human' ? formatExogenousTooltip(value.exogenous) : null;
  const tooltip = [exogenousPrefix, rationale].filter(Boolean).join('\n\n') || rationale;
  return { rationale, assistMode, tooltip };
}

function buildPlaceholderHorizonCell(
  h: ForecastHorizonMonth,
  category: string | null | undefined,
  lookup: Awaited<ReturnType<typeof loadSeasonalityLookup>>,
): ForecastHorizonCell {
  const categoryFactors = buildCategoryFactors(lookup, category, h.month);
  return {
    id: '',
    forecastYear: h.forecastYear,
    month: h.month,
    monthLabel: h.monthLabel,
    forecastDailyAvg: 0,
    manualDailyAvg: null,
    effectiveDailyAvg: 0,
    adjustReason: null,
    baselineDailyAvg: null,
    lifecycle: null,
    confidenceLevel: null,
    skuTrendFactor: null,
    seasonalityFactor: categoryFactors.seasonalityFactor,
    trendFactor: categoryFactors.trendFactor,
    categoryCombinedFactor: categoryFactors.categoryCombinedFactor,
    categoryTrendWasClipped: categoryFactors.categoryTrendWasClipped,
    categoryTrendMatched: categoryFactors.categoryTrendMatched,
    horizonFactors: null,
    allCatV41Factors: null,
    forecastModel: null,
    aiAssistRationale: null,
    aiAssistMode: null,
  };
}

async function loadHistoryQtyAggregated(input: {
  skuIds: string[];
  historyHorizon: ForecastHorizonMonth[];
}): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (!input.historyHorizon.length || !input.skuIds.length) return result;

  const first = input.historyHorizon[0]!;
  const monthlyBySku = await loadMonthlySalesBySkuIds({
    skuIds: input.skuIds,
    platform: 'ALL',
    minYear: first.forecastYear,
    minMonth: first.month,
  });

  for (const [skuId, rows] of monthlyBySku) {
    const byMonth = new Map<string, number>();
    for (const row of rows) {
      const label = formatForecastMonth(row.saleYear, row.month);
      byMonth.set(label, (byMonth.get(label) ?? 0) + row.qtySold);
    }
    result.set(`ALL::${skuId}`, byMonth);
  }

  return result;
}

type ForecastDetailRow = {
  id: string;
  skuId: string;
  station: string;
  platform: string;
  forecastYear: number;
  month: number;
  forecastDailyAvg: string | number;
  manualDailyAvg: string | number | null;
  adjustReason: string | null;
  baselineDailyAvg: string | number | null;
  lifecycle: string | null;
  confidenceLevel: string | null;
  horizonFactors: unknown;
  forecastModel: string | null;
  forecastProfileClass: string | null;
  profileSegment: string | null;
  skuCode: string;
  skuName: string;
  category: string | null;
};

function pickPrimaryForecastDetailRow(rows: ForecastDetailRow[]): ForecastDetailRow | null {
  return pickPrimaryTierRow(rows);
}

function resolveAnchorForecastDetailRow(rows: ForecastDetailRow[]): ForecastDetailRow | null {
  const firstMonth = findFirstForecastMonth(rows);
  if (!firstMonth) return null;
  const anchorRows = rows.filter((row) => isSameForecastMonth(row, firstMonth));
  return pickPrimaryForecastDetailRow(anchorRows);
}

function aggregateHorizonCellsForIdentity(input: {
  rows: ForecastDetailRow[];
  horizon: ForecastHorizonMonth[];
  category: string | null;
  seasonalityLookup: Awaited<ReturnType<typeof loadSeasonalityLookup>>;
}): ForecastHorizonCell[] {
  const byMonthLabel = new Map<string, ForecastDetailRow[]>();
  for (const row of input.rows) {
    const monthLabel = formatForecastMonth(row.forecastYear, row.month);
    const list = byMonthLabel.get(monthLabel) ?? [];
    list.push(row);
    byMonthLabel.set(monthLabel, list);
  }

  return input.horizon.map((h) => {
    const monthRows = byMonthLabel.get(h.monthLabel) ?? [];
    if (!monthRows.length) {
      return buildPlaceholderHorizonCell(h, input.category, input.seasonalityLookup);
    }

    const forecastMap = aggregateForecastRows(
      monthRows.map((row) => ({
        forecastYear: row.forecastYear,
        month: row.month,
        forecastDailyAvg: Number(row.forecastDailyAvg),
        platform: row.platform,
      })),
    );
    const forecastDailyAvg = forecastMap.get(h.monthLabel) ?? 0;

    let manualDailyAvg: number | null = null;
    let manualSum = 0;
    let hasManual = false;
    let baselineSum = 0;
    for (const row of monthRows) {
      const daily = mapForecastDailyFields({
        forecastDailyAvg: row.forecastDailyAvg,
        manualDailyAvg: row.manualDailyAvg,
      });
      if (daily.manualDailyAvg != null) {
        hasManual = true;
        manualSum += daily.manualDailyAvg;
      }
      baselineSum += numericOrNull(row.baselineDailyAvg) ?? 0;
    }
    if (hasManual) manualDailyAvg = Math.round(manualSum * 10_000) / 10_000;

    const effectiveDailyAvg = sumEffectiveForecastDailyAcrossPlatforms(monthRows);
    const primaryRow = pickPrimaryForecastDetailRow(monthRows) ?? monthRows[0]!;
    const categoryFactors = buildCategoryFactors(
      input.seasonalityLookup,
      input.category,
      h.month,
    );
    const baselineDailyAvg = baselineSum > 0 ? baselineSum : null;

    const aiAssist = parseAiAssistMeta(primaryRow.horizonFactors);
    return {
      id: primaryRow.id,
      forecastYear: h.forecastYear,
      month: h.month,
      monthLabel: h.monthLabel,
      forecastDailyAvg,
      manualDailyAvg,
      effectiveDailyAvg,
      adjustReason: primaryRow.adjustReason ?? null,
      baselineDailyAvg,
      lifecycle: primaryRow.lifecycle,
      confidenceLevel: primaryRow.confidenceLevel,
      skuTrendFactor: deriveSkuTrendFactor({
        forecastDailyAvg,
        baselineDailyAvg,
        categoryCombinedFactor: categoryFactors.categoryCombinedFactor,
      }),
      seasonalityFactor: categoryFactors.seasonalityFactor,
      trendFactor: categoryFactors.trendFactor,
      categoryCombinedFactor: categoryFactors.categoryCombinedFactor,
      categoryTrendWasClipped: categoryFactors.categoryTrendWasClipped,
      categoryTrendMatched: categoryFactors.categoryTrendMatched,
      horizonFactors: parseHorizonFactors(primaryRow.horizonFactors),
      allCatV41Factors: parseAllCatV41HorizonFactors(primaryRow.horizonFactors),
      forecastModel: primaryRow.forecastModel ?? null,
      aiAssistRationale: aiAssist.tooltip,
      aiAssistMode: aiAssist.assistMode,
    };
  });
}

async function listForecastHorizonAggregated(input: {
  versionId: string;
  station?: string;
  skuId?: string;
  skuCode?: string;
  category?: string;
  profileSegment?: string;
  pendingCalibration?: boolean;
  page: number;
  pageSize: number;
  offset: number;
  monthCount?: number;
  historyMonthCount: number;
  asOf: Date;
  version: Awaited<ReturnType<typeof getForecastVersionById>>;
}): Promise<ForecastHorizonResult> {
  const stationFilter = normalizeForecastStation(input.station);
  const conditions = [
    eq(salesForecastMonthly.versionId, input.versionId),
    inArray(salesForecastMonthly.platform, [...FORECAST_V41_PLATFORM_CODES]),
    eq(salesForecastMonthly.station, stationFilter),
  ];
  if (input.skuId?.trim()) {
    conditions.push(eq(salesForecastMonthly.skuId, input.skuId.trim()));
  } else if (input.skuCode?.trim()) {
    conditions.push(ilike(skus.code, `%${input.skuCode.trim()}%`));
  }
  if (input.category?.trim()) {
    const categoryCondition = categoryMatchesFilterCondition(
      sql<string | null>`null`,
      skus.category,
      input.category,
    );
    if (categoryCondition) conditions.push(categoryCondition);
  }

  const tierSkuIds = await loadAnchorTierFilteredSkuIds({
    versionId: input.versionId,
    stationFilter,
    profileSegment: input.profileSegment,
    pendingCalibration: input.pendingCalibration,
  });
  if (tierSkuIds !== null) {
    if (!tierSkuIds.length) {
      const horizon = input.monthCount
        ? buildConfiguredHorizonLabels(input.monthCount, input.asOf)
        : [];
      const historyHorizon = buildHistoryMonthLabels(input.historyMonthCount, input.asOf);
      return {
        horizon,
        historyHorizon,
        items: [],
        total: 0,
        page: input.page,
        pageSize: input.pageSize,
        version: input.version
          ? {
              id: input.version.id,
              versionName: input.version.versionName,
              status: input.version.status,
              station: input.version.station,
            }
          : null,
      };
    }
    conditions.push(inArray(salesForecastMonthly.skuId, tierSkuIds));
  }

  const where = and(...conditions);

  const identityRows = await db
    .selectDistinct({
      skuId: salesForecastMonthly.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      category: skus.category,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(where)
    .orderBy(asc(skus.code))
    .limit(input.pageSize)
    .offset(input.offset);

  const [countRow, monthLabelRows, seasonalityLookup] = await Promise.all([
    db
      .select({
        count: sql<number>`count(distinct ${salesForecastMonthly.skuId})::int`,
      })
      .from(salesForecastMonthly)
      .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
      .where(where),
    db
      .selectDistinct({
        forecastYear: salesForecastMonthly.forecastYear,
        month: salesForecastMonthly.month,
      })
      .from(salesForecastMonthly)
      .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
      .where(where)
      .orderBy(asc(salesForecastMonthly.forecastYear), asc(salesForecastMonthly.month)),
    loadSeasonalityLookup(),
  ]);

  const dataHorizon = buildHorizonLabels(monthLabelRows);
  const horizon = input.monthCount
    ? buildConfiguredHorizonLabels(input.monthCount, input.asOf)
    : dataHorizon;
  const historyHorizon = buildHistoryMonthLabels(input.historyMonthCount, input.asOf);

  if (!identityRows.length) {
    return {
      horizon,
      historyHorizon,
      items: [],
      total: countRow[0]?.count ?? 0,
      page: input.page,
      pageSize: input.pageSize,
      version: input.version
        ? {
            id: input.version.id,
            versionName: input.version.versionName,
            status: input.version.status,
            station: input.version.station,
          }
        : null,
    };
  }

  const skuIds = Array.from(new Set(identityRows.map((row) => row.skuId)));
  const identityKeySet = new Set(identityRows.map((row) => row.skuId));

  const detailRows = await db
    .select({
      id: salesForecastMonthly.id,
      skuId: salesForecastMonthly.skuId,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      manualDailyAvg: salesForecastMonthly.manualDailyAvg,
      adjustReason: salesForecastMonthly.adjustReason,
      baselineDailyAvg: salesForecastMonthly.baselineDailyAvg,
      lifecycle: salesForecastMonthly.lifecycle,
      confidenceLevel: salesForecastMonthly.confidenceLevel,
      horizonFactors: salesForecastMonthly.horizonFactors,
      forecastModel: salesForecastMonthly.forecastModel,
      forecastProfileClass: salesForecastMonthly.forecastProfileClass,
      profileSegment: salesForecastMonthly.profileSegment,
      skuCode: skus.code,
      skuName: skus.name,
      category: skus.category,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(
      and(
        eq(salesForecastMonthly.versionId, input.versionId),
        eq(salesForecastMonthly.station, stationFilter),
        inArray(salesForecastMonthly.skuId, skuIds),
        inArray(salesForecastMonthly.platform, [...FORECAST_V41_PLATFORM_CODES]),
      ),
    )
    .orderBy(asc(skus.code), asc(salesForecastMonthly.forecastYear), asc(salesForecastMonthly.month));

  const filteredDetailRows = detailRows.filter((row) => identityKeySet.has(row.skuId));

  const historyQtyBySku = historyHorizon.length
    ? await loadHistoryQtyAggregated({ skuIds, historyHorizon })
    : new Map<string, Map<string, number>>();

  const rowsByIdentity = new Map<string, ForecastDetailRow[]>();
  const profileByIdentity = new Map<
    string,
    { forecastProfileClass: string | null; profileSegment: string | null }
  >();

  for (const row of filteredDetailRows) {
    const key = row.skuId;
    const list = rowsByIdentity.get(key) ?? [];
    list.push(row);
    rowsByIdentity.set(key, list);
  }

  for (const [key, skuRows] of rowsByIdentity) {
    const primary = resolveAnchorForecastDetailRow(skuRows);
    if (primary && (primary.profileSegment || primary.forecastProfileClass)) {
      profileByIdentity.set(key, {
        forecastProfileClass: primary.forecastProfileClass ?? null,
        profileSegment: primary.profileSegment ?? null,
      });
    }
  }

  const items: ForecastHorizonRow[] = identityRows.map((identity) => {
    const key = identity.skuId;
    const platformRows = rowsByIdentity.get(key) ?? [];
    const months = aggregateHorizonCellsForIdentity({
      rows: platformRows,
      horizon,
      category: identity.category,
      seasonalityLookup,
    });
    const lifecycle = months.find((cell) => cell.lifecycle)?.lifecycle ?? null;
    const qtyByMonth = historyQtyBySku.get(`ALL::${identity.skuId}`) ?? new Map<string, number>();
    const historyMonths = buildHistoryCellsForSku(historyHorizon, qtyByMonth);
    const profile = profileByIdentity.get(key);

    return {
      skuId: identity.skuId,
      skuCode: identity.skuCode,
      skuName: identity.skuName,
      category: identity.category,
      station: FORECAST_GLOBAL_STATION,
      platform: 'ALL',
      lifecycle,
      forecastProfileClass: profile?.forecastProfileClass ?? null,
      profileSegment: profile?.profileSegment ?? null,
      months,
      historyMonths,
    };
  });

  return {
    horizon,
    historyHorizon,
    items,
    total: countRow[0]?.count ?? 0,
    page: input.page,
    pageSize: input.pageSize,
    version: input.version
      ? {
          id: input.version.id,
          versionName: input.version.versionName,
          status: input.version.status,
          station: input.version.station,
        }
      : null,
  };
}

export async function listForecastHorizon(input: {
  versionId?: string;
  station?: string;
  platform?: string;
  skuId?: string;
  skuCode?: string;
  category?: string;
  profileSegment?: string;
  pendingCalibration?: boolean;
  page?: number;
  pageSize?: number;
  monthCount?: number;
  historyMonthCount?: number;
  asOf?: Date;
}): Promise<ForecastHorizonResult> {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, input.pageSize ?? 20));
  const offset = (page - 1) * pageSize;
  const asOf = input.asOf ?? new Date();
  const monthCount =
    input.monthCount != null && Number.isFinite(input.monthCount)
      ? Math.min(MAX_FORECAST_MONTH_COUNT, Math.max(1, Math.floor(input.monthCount)))
      : undefined;
  const historyMonthCount =
    input.historyMonthCount != null && Number.isFinite(input.historyMonthCount)
      ? Math.min(36, Math.max(0, Math.floor(input.historyMonthCount)))
      : 0;

  const explicitVersionId = input.versionId?.trim() || undefined;
  if (!explicitVersionId) {
    return {
      horizon: [],
      historyHorizon: [],
      items: [],
      total: 0,
      page,
      pageSize,
      version: null,
    };
  }
  const versionId = explicitVersionId;
  const version = await getForecastVersionById(versionId);
  const stationFilter = normalizeForecastStation(input.station);

  const platformNormalized = normalizeSalesPlatform(input.platform?.trim() || 'ALL');
  if (platformNormalized === 'ALL') {
    return listForecastHorizonAggregated({
      versionId,
      station: stationFilter,
      skuId: input.skuId,
      skuCode: input.skuCode,
      category: input.category,
      profileSegment: input.profileSegment,
      pendingCalibration: input.pendingCalibration,
      page,
      pageSize,
      offset,
      monthCount,
      historyMonthCount,
      asOf,
      version,
    });
  }

  const conditions = [
    eq(salesForecastMonthly.versionId, versionId),
    eq(salesForecastMonthly.station, stationFilter),
    eq(salesForecastMonthly.platform, platformNormalized),
  ];
  if (input.skuId?.trim()) {
    conditions.push(eq(salesForecastMonthly.skuId, input.skuId.trim()));
  } else if (input.skuCode?.trim()) {
    conditions.push(ilike(skus.code, `%${input.skuCode.trim()}%`));
  }
  if (input.category?.trim()) {
    const categoryCondition = categoryMatchesFilterCondition(
      sql<string | null>`null`,
      skus.category,
      input.category,
    );
    if (categoryCondition) conditions.push(categoryCondition);
  }
  if (versionId) {
    appendHorizonPlatformTierFilter(conditions, {
      versionId,
      profileSegment: input.profileSegment,
      pendingCalibration: input.pendingCalibration,
    });
  }

  const where = and(...conditions);

  const identityRows = await db
    .selectDistinct({
      skuId: salesForecastMonthly.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      category: skus.category,
      platform: salesForecastMonthly.platform,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(where)
    .orderBy(asc(skus.code), asc(salesForecastMonthly.platform))
    .limit(pageSize)
    .offset(offset);

  const [countRow, monthLabelRows, seasonalityLookup] = await Promise.all([
    db
      .select({
        count: sql<number>`count(distinct (${salesForecastMonthly.skuId}, ${salesForecastMonthly.platform}))::int`,
      })
      .from(salesForecastMonthly)
      .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
      .where(where),
    db
      .selectDistinct({
        forecastYear: salesForecastMonthly.forecastYear,
        month: salesForecastMonthly.month,
      })
      .from(salesForecastMonthly)
      .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
      .where(where)
      .orderBy(asc(salesForecastMonthly.forecastYear), asc(salesForecastMonthly.month)),
    loadSeasonalityLookup(),
  ]);

  const dataHorizon = buildHorizonLabels(monthLabelRows);
  const horizon = monthCount
    ? buildConfiguredHorizonLabels(monthCount, asOf)
    : dataHorizon;
  const historyHorizon = buildHistoryMonthLabels(historyMonthCount, asOf);

  if (!identityRows.length) {
    return {
      horizon,
      historyHorizon,
      items: [],
      total: countRow[0]?.count ?? 0,
      page,
      pageSize,
      version: version
        ? {
            id: version.id,
            versionName: version.versionName,
            status: version.status,
            station: version.station,
          }
        : null,
    };
  }

  const identityKeySet = new Set(
    identityRows.map((row) => `${row.skuId}::${row.platform}`),
  );
  const skuIds = Array.from(new Set(identityRows.map((row) => row.skuId)));

  const detailRows = await db
    .select({
      id: salesForecastMonthly.id,
      skuId: salesForecastMonthly.skuId,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      manualDailyAvg: salesForecastMonthly.manualDailyAvg,
      adjustReason: salesForecastMonthly.adjustReason,
      baselineDailyAvg: salesForecastMonthly.baselineDailyAvg,
      lifecycle: salesForecastMonthly.lifecycle,
      confidenceLevel: salesForecastMonthly.confidenceLevel,
      horizonFactors: salesForecastMonthly.horizonFactors,
      forecastModel: salesForecastMonthly.forecastModel,
      forecastProfileClass: salesForecastMonthly.forecastProfileClass,
      profileSegment: salesForecastMonthly.profileSegment,
      skuCode: skus.code,
      skuName: skus.name,
      category: skus.category,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(
      and(
        eq(salesForecastMonthly.versionId, versionId),
        eq(salesForecastMonthly.station, stationFilter),
        inArray(salesForecastMonthly.skuId, skuIds),
      ),
    )
    .orderBy(asc(skus.code), asc(salesForecastMonthly.forecastYear), asc(salesForecastMonthly.month));

  const [filteredDetailRows, historyQtyBySkuPlatform] = await Promise.all([
    Promise.resolve(
      detailRows.filter((row) => identityKeySet.has(`${row.skuId}::${row.platform}`)),
    ),
    historyHorizon.length
      ? loadHistoryQtyBySkuPlatform({ identities: identityRows, historyHorizon })
      : Promise.resolve(new Map<string, Map<string, number>>()),
  ]);

  const cellsByIdentity = new Map<string, ForecastHorizonCell[]>();
  const metaByIdentity = new Map<string, ForecastIdentity>();
  const profileByIdentity = new Map<
    string,
    { forecastProfileClass: string | null; profileSegment: string | null }
  >();
  const detailRowsByIdentity = new Map<string, ForecastDetailRow[]>();

  for (const row of identityRows) {
    const key = `${row.skuId}::${row.platform}`;
    metaByIdentity.set(key, { ...row, station: FORECAST_GLOBAL_STATION });
    cellsByIdentity.set(key, []);
    detailRowsByIdentity.set(key, []);
  }

  for (const row of filteredDetailRows) {
    const key = `${row.skuId}::${row.platform}`;
    detailRowsByIdentity.get(key)?.push(row);
    const dailyFields = mapForecastDailyFields({
      forecastDailyAvg: row.forecastDailyAvg,
      manualDailyAvg: row.manualDailyAvg,
    });
    const forecastDailyAvg = dailyFields.forecastDailyAvg;
    const baselineDailyAvg = numericOrNull(row.baselineDailyAvg);
    const categoryFactors = buildCategoryFactors(seasonalityLookup, row.category, row.month);

    const aiAssist = parseAiAssistMeta(row.horizonFactors);
    cellsByIdentity.get(key)?.push({
      id: row.id,
      forecastYear: row.forecastYear,
      month: row.month,
      monthLabel: formatForecastMonth(row.forecastYear, row.month),
      forecastDailyAvg,
      manualDailyAvg: dailyFields.manualDailyAvg,
      effectiveDailyAvg: dailyFields.effectiveDailyAvg,
      adjustReason: row.adjustReason ?? null,
      baselineDailyAvg,
      lifecycle: row.lifecycle,
      confidenceLevel: row.confidenceLevel,
      skuTrendFactor: deriveSkuTrendFactor({
        forecastDailyAvg,
        baselineDailyAvg,
        categoryCombinedFactor: categoryFactors.categoryCombinedFactor,
      }),
      seasonalityFactor: categoryFactors.seasonalityFactor,
      trendFactor: categoryFactors.trendFactor,
      categoryCombinedFactor: categoryFactors.categoryCombinedFactor,
      categoryTrendWasClipped: categoryFactors.categoryTrendWasClipped,
      categoryTrendMatched: categoryFactors.categoryTrendMatched,
      horizonFactors: parseHorizonFactors(row.horizonFactors),
      allCatV41Factors: parseAllCatV41HorizonFactors(row.horizonFactors),
      forecastModel: row.forecastModel ?? null,
      aiAssistRationale: aiAssist.tooltip,
      aiAssistMode: aiAssist.assistMode,
    });
  }

  for (const [key, identityRowsForKey] of detailRowsByIdentity) {
    const primary = resolveAnchorForecastDetailRow(identityRowsForKey);
    if (primary && (primary.profileSegment || primary.forecastProfileClass)) {
      profileByIdentity.set(key, {
        forecastProfileClass: primary.forecastProfileClass ?? null,
        profileSegment: primary.profileSegment ?? null,
      });
    }
  }

  const items: ForecastHorizonRow[] = identityRows.map((identity) => {
    const key = `${identity.skuId}::${identity.platform}`;
    const months = cellsByIdentity.get(key) ?? [];
    const lifecycle = months.find((cell) => cell.lifecycle)?.lifecycle ?? null;
    const monthByLabel = new Map(months.map((cell) => [cell.monthLabel, cell]));
    const orderedMonths = horizon.map(
      (h) =>
        monthByLabel.get(h.monthLabel) ??
        buildPlaceholderHorizonCell(h, identity.category, seasonalityLookup),
    );

    const historyKey = `${normalizeSalesPlatform(identity.platform)}::${identity.skuId}`;
    const qtyByMonth = historyQtyBySkuPlatform.get(historyKey) ?? new Map<string, number>();
    const historyMonths = buildHistoryCellsForSku(historyHorizon, qtyByMonth);

    const profile = profileByIdentity.get(key);
    return {
      skuId: identity.skuId,
      skuCode: identity.skuCode,
      skuName: identity.skuName,
      category: identity.category,
      station: FORECAST_GLOBAL_STATION,
      platform: identity.platform,
      lifecycle,
      forecastProfileClass: profile?.forecastProfileClass ?? null,
      profileSegment: profile?.profileSegment ?? null,
      months: orderedMonths,
      historyMonths,
    };
  });

  return {
    horizon,
    historyHorizon,
    items,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
    version: version
      ? {
          id: version.id,
          versionName: version.versionName,
          status: version.status,
          station: version.station,
        }
      : null,
  };
}
