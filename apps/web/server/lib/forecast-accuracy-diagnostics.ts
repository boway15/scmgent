import { desc, eq, sql, type SQL } from 'drizzle-orm';
import { db, salesForecastVersions } from '@scm/db';
import { capSkuWmapeForStats } from './forecast-accuracy-tier.js';
import { PROFILE_SEGMENT_META, type ProfileSegment } from './forecast-profile-class.js';

export type ForecastAccuracyDiagnosticsInput = {
  versionId?: string;
  versionName?: string;
  station?: string;
  platform?: string;
  startMonth?: string;
  endMonth?: string;
  asOf?: string;
  limitTopErrors?: number;
};

export type ForecastAccuracyReviewQueueInput = {
  sourceVersionId?: string;
  sourceVersionName?: string;
  targetVersionId: string;
  station?: string;
  platform?: string;
  startMonth?: string;
  endMonth?: string;
  limit?: number;
  minWmape?: number;
};

export type ForecastAccuracyReviewQueueResult = {
  sourceVersion: {
    id: string;
    versionName: string;
    status: string;
  };
  targetVersion: {
    id: string;
    versionName: string;
    status: string;
  };
  candidates: number;
  upserted: number;
  skippedCompleted: number;
  items: Array<{
    skuId: string;
    skuCode: string;
    skuName: string;
    station: string;
    platform: string;
    severity: 'critical' | 'warning';
    wmape: number | null;
    weightedBias: number | null;
    ghostRows: number;
    zeroForecastMissRows: number;
    suggestedDailyAvg: number | null;
  }>;
};

export type ForecastAccuracyDiagnosticScope = {
  versionId?: string;
  versionName?: string;
  versionStatus?: string;
  versionStation?: string | null;
  station?: string;
  platform?: string;
  startMonth?: string;
  endMonth?: string;
  asOf?: string;
  versionSelection?: 'explicit' | 'auto_published' | 'auto_latest';
};

export type ForecastAccuracyDataQuality = {
  monthlyRows: number;
  monthlySkuCount: number;
  monthlyStartMonth?: string;
  monthlyEndMonth?: string;
  unknownChannelRows: number;
  unknownChannelQty: number;
  totalMonthlyQty: number;
  unknownChannelQtyRate: number | null;
  dailyMonthlyComparedRows: number;
  dailyMonthlyComparedMonths: number;
  dailyMonthlyAbsDiffQty: number;
  dailyMonthlyBaseQty: number;
  dailyMonthlyAbsDiffRate: number | null;
};

export type ForecastAccuracyMetricSummary = {
  key?: string;
  label?: string;
  rows: number;
  skuCount: number;
  comparableRows: number;
  wmape: number | null;
  weightedBias: number | null;
  ghostRows: number;
  zeroForecastMissRows: number;
  actualDailySum: number;
  forecastDailySum: number;
};

export type ForecastAccuracyTopErrorSku = {
  skuId: string;
  skuCode: string;
  skuName: string;
  category: string | null;
  volumeTier: string;
  profileSegment: string;
  rows: number;
  comparableRows: number;
  wmape: number | null;
  weightedBias: number | null;
  ghostRows: number;
  zeroForecastMissRows: number;
  actualDailySum: number;
  forecastDailySum: number;
  absErrorSum: number;
};

export type ForecastAccuracyDiagnostics = {
  scope: ForecastAccuracyDiagnosticScope;
  dataQuality: ForecastAccuracyDataQuality;
  global: ForecastAccuracyMetricSummary;
  byHorizonBand: ForecastAccuracyMetricSummary[];
  byProfileSegment: ForecastAccuracyMetricSummary[];
  byVolumeTier: ForecastAccuracyMetricSummary[];
  byCategory: ForecastAccuracyMetricSummary[];
  topErrorSkus: ForecastAccuracyTopErrorSku[];
  recommendations: string[];
};

type YearMonth = { year: number; month: number; key: string; serial: number };

type VersionScopeRow = {
  id: string;
  versionName: string;
  status: string;
  station: string | null;
  createdAt: Date | string;
};

type MetricSqlRow = {
  key?: string | null;
  rows?: number | string | null;
  skuCount?: number | string | null;
  comparableRows?: number | string | null;
  wmape?: number | string | null;
  weightedBias?: number | string | null;
  ghostRows?: number | string | null;
  zeroForecastMissRows?: number | string | null;
  actualDailySum?: number | string | null;
  forecastDailySum?: number | string | null;
  minForecastMonth?: string | null;
  maxForecastMonth?: string | null;
};

type TopErrorSqlRow = MetricSqlRow & {
  skuId: string;
  skuCode: string;
  skuName: string;
  category: string | null;
  volumeTier: string;
  profileSegment: string;
  absErrorSum?: number | string | null;
};

const HORIZON_LABELS: Record<string, string> = {
  precision: '1–3 月（精准备货）',
  flex: '3–6 月（生产柔性）',
  strategic: '6–12 月（战略库容）',
  unknown: '未分带',
};

const VOLUME_TIER_LABELS: Record<string, string> = {
  core: '主力 SKU（实际日均 ≥5）',
  mid: '腰部 SKU（实际日均 1–5）',
  tail: '长尾 SKU（实际日均 <1）',
  skipped: '零销量 SKU',
};

function parseYearMonth(value: string | undefined, name: string): YearMonth | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  const match = /^(\d{4})-(\d{2})$/.exec(trimmed);
  if (!match) throw new Error(`${name} must use YYYY-MM format`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`${name} must use YYYY-MM format`);
  }
  return {
    year,
    month,
    key: `${year}-${String(month).padStart(2, '0')}`,
    serial: year * 100 + month,
  };
}

function normalizeCode(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

function toNumber(value: unknown): number {
  if (value == null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toNullableNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInt(value: unknown): number {
  return Math.trunc(toNumber(value));
}

function rowsOf<T>(result: unknown): T[] {
  return Array.from(result as Iterable<T>);
}

function metricFromRow(row: MetricSqlRow, key?: string, label?: string): ForecastAccuracyMetricSummary {
  return {
    key,
    label,
    rows: toInt(row.rows),
    skuCount: toInt(row.skuCount),
    comparableRows: toInt(row.comparableRows),
    wmape: toNullableNumber(row.wmape),
    weightedBias: toNullableNumber(row.weightedBias),
    ghostRows: toInt(row.ghostRows),
    zeroForecastMissRows: toInt(row.zeroForecastMissRows),
    actualDailySum: toNumber(row.actualDailySum),
    forecastDailySum: toNumber(row.forecastDailySum),
  };
}

function profileSegmentLabel(segment: string): string {
  return PROFILE_SEGMENT_META[segment as ProfileSegment]?.label ?? segment;
}

function horizonProfileLabel(key: string): string {
  const sep = key.indexOf('|');
  if (sep < 0) return HORIZON_LABELS[key] ?? key;
  const horizon = key.slice(0, sep);
  const segment = key.slice(sep + 1);
  const h = HORIZON_LABELS[horizon] ?? horizon;
  const s = profileSegmentLabel(segment);
  return `${h} × ${s}`;
}

function buildAccuracyFilters(input: {
  versionId?: string;
  station?: string;
  platform?: string;
  start?: YearMonth;
  end?: YearMonth;
}): SQL[] {
  const filters: SQL[] = [];
  if (input.versionId) filters.push(sql`fa.version_id = ${input.versionId}::uuid`);
  if (input.station) filters.push(sql`fa.station = ${input.station}`);
  if (input.platform) filters.push(sql`fa.platform = ${input.platform}`);
  if (input.start) filters.push(sql`(fa.forecast_year * 100 + fa.month) >= ${input.start.serial}`);
  if (input.end) filters.push(sql`(fa.forecast_year * 100 + fa.month) <= ${input.end.serial}`);
  return filters;
}

function buildMonthFilters(input: {
  platform?: string;
  start?: YearMonth;
  end?: YearMonth;
  alias?: 'm' | 'd';
}): SQL[] {
  const a = input.alias ?? 'm';
  const filters: SQL[] = [];
  if (input.platform && input.platform !== 'ALL') {
    if (a === 'm') filters.push(sql`upper(${sql.raw(a)}.channel) = ${input.platform}`);
    else filters.push(sql`upper(coalesce(${sql.raw(a)}.channel, 'UNKNOWN')) = ${input.platform}`);
  }
  if (input.start) {
    if (a === 'm') filters.push(sql`(${sql.raw(a)}.sale_year * 100 + ${sql.raw(a)}.month) >= ${input.start.serial}`);
    else filters.push(sql`(extract(year from ${sql.raw(a)}.sale_date)::int * 100 + extract(month from ${sql.raw(a)}.sale_date)::int) >= ${input.start.serial}`);
  }
  if (input.end) {
    if (a === 'm') filters.push(sql`(${sql.raw(a)}.sale_year * 100 + ${sql.raw(a)}.month) <= ${input.end.serial}`);
    else filters.push(sql`(extract(year from ${sql.raw(a)}.sale_date)::int * 100 + extract(month from ${sql.raw(a)}.sale_date)::int) <= ${input.end.serial}`);
  }
  return filters;
}

function whereClause(filters: SQL[]): SQL {
  return filters.length ? sql`where ${sql.join(filters, sql` and `)}` : sql``;
}

async function loadVersionById(versionId: string): Promise<VersionScopeRow | null> {
  const [row] = await db
    .select({
      id: salesForecastVersions.id,
      versionName: salesForecastVersions.versionName,
      status: salesForecastVersions.status,
      station: salesForecastVersions.station,
      createdAt: salesForecastVersions.createdAt,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);
  return row ?? null;
}

async function loadVersionByName(versionName: string): Promise<VersionScopeRow | null> {
  const [row] = await db
    .select({
      id: salesForecastVersions.id,
      versionName: salesForecastVersions.versionName,
      status: salesForecastVersions.status,
      station: salesForecastVersions.station,
      createdAt: salesForecastVersions.createdAt,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.versionName, versionName))
    .orderBy(desc(salesForecastVersions.createdAt))
    .limit(1);
  return row ?? null;
}

async function loadLatestAccuracyVersion(input: {
  station?: string;
  platform?: string;
  start?: YearMonth;
  end?: YearMonth;
}): Promise<VersionScopeRow | null> {
  const filters = buildAccuracyFilters({
    station: input.station,
    platform: input.platform,
    start: input.start,
    end: input.end,
  });
  filters.push(sql`fa.version_id is not null`);

  const result = await db.execute(sql`
    select
      v.id,
      v.version_name as "versionName",
      v.status::text as status,
      v.station,
      v.created_at as "createdAt"
    from sales_forecast_versions v
    join forecast_accuracy_monthly fa on fa.version_id = v.id
    ${whereClause(filters)}
    group by v.id
    order by
      case when v.status = 'published' then 0 else 1 end,
      max(coalesce(v.published_at, v.created_at)) desc,
      max(v.created_at) desc
    limit 1
  `);
  return rowsOf<VersionScopeRow>(result)[0] ?? null;
}

function buildBaseCte(filters: SQL[], horizonRef?: YearMonth): SQL {
  const horizonFallback = horizonRef
    ? sql`case
        when ((fa.forecast_year - ${horizonRef.year}) * 12 + (fa.month - ${horizonRef.month})) <= 2 then 'precision'
        when ((fa.forecast_year - ${horizonRef.year}) * 12 + (fa.month - ${horizonRef.month})) <= 5 then 'flex'
        else 'strategic'
      end`
    : sql`'unknown'`;

  return sql`
    with base as (
      select
        fa.sku_id,
        s.code as sku_code,
        s.name as sku_name,
        s.category,
        fa.station,
        fa.platform,
        fa.forecast_year,
        fa.month,
        fa.forecast_daily_avg::numeric as forecast_daily,
        fa.actual_daily_avg::numeric as actual_daily,
        (fa.forecast_daily_avg::numeric - fa.actual_daily_avg::numeric) as error,
        abs(fa.forecast_daily_avg::numeric - fa.actual_daily_avg::numeric) as abs_error,
        coalesce(nullif(sfm.profile_segment, ''), 'unclassified') as profile_segment,
        coalesce(nullif(sfm.horizon_band, ''), ${horizonFallback}) as horizon_band
      from forecast_accuracy_monthly fa
      join skus s on s.id = fa.sku_id
      left join sales_forecast_monthly sfm on sfm.version_id = fa.version_id
        and sfm.sku_id = fa.sku_id
        and sfm.station = fa.station
        and sfm.platform = fa.platform
        and sfm.forecast_year = fa.forecast_year
        and sfm.month = fa.month
      ${whereClause(filters)}
    ), sku_tier as (
      select
        sku_id,
        case
          when coalesce(sum(actual_daily), 0) <= 0 then 'skipped'
          when avg(actual_daily) filter (where actual_daily > 0) >= 5 then 'core'
          when avg(actual_daily) filter (where actual_daily > 0) >= 1 then 'mid'
          else 'tail'
        end as volume_tier
      from base
      group by sku_id
    ), scored as (
      select
        b.*,
        st.volume_tier,
        (b.forecast_daily > 0) as stats_comparable,
        (
          b.actual_daily > 0
          and b.profile_segment not in ('T4B', 'T99')
          and b.profile_segment not like 'D:%'
        ) as kpi_comparable
      from base b
      join sku_tier st on st.sku_id = b.sku_id
    )
  `;
}

function rollupCountMetricsSql(tableAlias: 'scored' | 'keyed'): SQL {
  const t = tableAlias;
  return sql.raw(`
    count(*)::int as rows,
    count(distinct ${t}.sku_id)::int as "skuCount",
    count(*) filter (where ${t}.stats_comparable)::int as "comparableRows",
    count(*) filter (where ${t}.actual_daily = 0 and ${t}.forecast_daily > 0)::int as "ghostRows",
    count(*) filter (where ${t}.actual_daily > 0 and ${t}.forecast_daily = 0)::int as "zeroForecastMissRows",
    coalesce(sum(${t}.actual_daily), 0)::float8 as "actualDailySum",
    coalesce(sum(${t}.forecast_daily), 0)::float8 as "forecastDailySum"
  `);
}

/** 诊断期内 KPI 可比行全期汇总 */
function pooledPeriodKpiSql(tableAlias: 'scored' | 'keyed' = 'scored'): SQL {
  const t = tableAlias;
  return sql.raw(`
    sum(${t}.abs_error) filter (where ${t}.stats_comparable)
      / nullif(sum(${t}.actual_daily) filter (where ${t}.stats_comparable and ${t}.actual_daily > 0), 0)::float8 as wmape,
    sum(${t}.error) filter (where ${t}.stats_comparable)
      / nullif(sum(${t}.actual_daily) filter (where ${t}.stats_comparable and ${t}.actual_daily > 0), 0)::float8 as "weightedBias"
  `);
}

function metricSelectSql(tableAlias: 'scored' | 'keyed' = 'scored'): SQL {
  return sql`
    ${rollupCountMetricsSql(tableAlias)},
    ${pooledPeriodKpiSql(tableAlias)}
  `;
}

async function loadGlobalMetrics(filters: SQL[], horizonRef?: YearMonth): Promise<ForecastAccuracyMetricSummary & {
  minForecastMonth?: string;
  maxForecastMonth?: string;
}> {
  const result = await db.execute(sql`
    ${buildBaseCte(filters, horizonRef)}
    select
      ${metricSelectSql('scored')},
      min(format('%s-%s', scored.forecast_year, lpad(scored.month::text, 2, '0'))) as "minForecastMonth",
      max(format('%s-%s', scored.forecast_year, lpad(scored.month::text, 2, '0'))) as "maxForecastMonth"
    from scored
  `);
  const row = rowsOf<MetricSqlRow>(result)[0] ?? {};
  return {
    ...metricFromRow(row),
    minForecastMonth: row.minForecastMonth ?? undefined,
    maxForecastMonth: row.maxForecastMonth ?? undefined,
  };
}

async function loadGroupedMetrics(input: {
  filters: SQL[];
  horizonRef?: YearMonth;
  dimensionSql: SQL;
  labelForKey?: (key: string) => string;
  limit?: number;
  minComparableRows?: number;
  orderBySql?: SQL;
}): Promise<ForecastAccuracyMetricSummary[]> {
  const limit = Math.max(1, Math.min(100, Math.floor(input.limit ?? 30)));
  const minComparableRows = Math.max(0, Math.floor(input.minComparableRows ?? 0));
  const orderBy = input.orderBySql ?? sql`
    coalesce(sum(keyed.abs_error) filter (where keyed.actual_daily > 0), 0) desc,
    count(*) filter (where keyed.actual_daily = 0 and keyed.forecast_daily > 0) desc
  `;
  const result = await db.execute(sql`
    ${buildBaseCte(input.filters, input.horizonRef)}
    , keyed as (
      select scored.*, ${input.dimensionSql} as dim_key
      from scored
    )
    select
      keyed.dim_key as key,
      ${rollupCountMetricsSql('keyed')},
      ${pooledPeriodKpiSql('keyed')}
    from keyed
    group by keyed.dim_key
    having count(*) filter (where keyed.stats_comparable) >= ${minComparableRows}
    order by ${orderBy}
    limit ${limit}
  `);

  return rowsOf<MetricSqlRow>(result).map((row) => {
    const key = row.key ?? 'unknown';
    return metricFromRow(row, key, input.labelForKey ? input.labelForKey(key) : key);
  });
}

async function loadTopErrorSkus(input: {
  filters: SQL[];
  horizonRef?: YearMonth;
  limit: number;
}): Promise<ForecastAccuracyTopErrorSku[]> {
  const limit = Math.max(1, Math.min(200, Math.floor(input.limit)));
  const result = await db.execute(sql`
    ${buildBaseCte(input.filters, input.horizonRef)}
    , sku_kpi as (
      select
        sku_id,
        sku_code,
        sku_name,
        category,
        volume_tier,
        profile_segment,
        sum(abs_error) filter (where stats_comparable)
          / nullif(sum(actual_daily) filter (where stats_comparable and actual_daily > 0), 0)::float8 as wmape,
        sum(error) filter (where stats_comparable)
          / nullif(sum(actual_daily) filter (where stats_comparable and actual_daily > 0), 0)::float8 as "weightedBias"
      from scored
      group by sku_id, sku_code, sku_name, category, volume_tier, profile_segment
      having sum(actual_daily) filter (where stats_comparable and actual_daily > 0) > 0
        or count(*) filter (where stats_comparable and actual_daily = 0 and forecast_daily > 0) > 0
    )
    select
      scored.sku_id::text as "skuId",
      scored.sku_code as "skuCode",
      scored.sku_name as "skuName",
      scored.category,
      scored.volume_tier as "volumeTier",
      scored.profile_segment as "profileSegment",
      ${rollupCountMetricsSql('scored')},
      sku_kpi.wmape,
      sku_kpi."weightedBias",
      coalesce(sum(scored.abs_error) filter (where scored.actual_daily > 0), 0)::float8 as "absErrorSum"
    from scored
    join sku_kpi on sku_kpi.sku_id = scored.sku_id
      and sku_kpi.sku_code = scored.sku_code
      and sku_kpi.sku_name = scored.sku_name
      and sku_kpi.category is not distinct from scored.category
      and sku_kpi.volume_tier is not distinct from scored.volume_tier
      and sku_kpi.profile_segment is not distinct from scored.profile_segment
    group by
      scored.sku_id,
      scored.sku_code,
      scored.sku_name,
      scored.category,
      scored.volume_tier,
      scored.profile_segment,
      sku_kpi.wmape,
      sku_kpi."weightedBias"
    having coalesce(sum(scored.abs_error), 0) > 0
      or count(*) filter (where scored.actual_daily = 0 and scored.forecast_daily > 0) > 0
    order by
      coalesce(sum(scored.abs_error) filter (where scored.actual_daily > 0), 0) desc,
      count(*) filter (where scored.actual_daily = 0 and scored.forecast_daily > 0) desc
    limit ${limit}
  `);

  return rowsOf<TopErrorSqlRow>(result).map((row) => ({
    skuId: row.skuId,
    skuCode: row.skuCode,
    skuName: row.skuName,
    category: row.category,
    volumeTier: row.volumeTier,
    profileSegment: row.profileSegment,
    rows: toInt(row.rows),
    comparableRows: toInt(row.comparableRows),
    wmape: capSkuWmapeForStats(toNullableNumber(row.wmape)),
    weightedBias: toNullableNumber(row.weightedBias),
    ghostRows: toInt(row.ghostRows),
    zeroForecastMissRows: toInt(row.zeroForecastMissRows),
    actualDailySum: toNumber(row.actualDailySum),
    forecastDailySum: toNumber(row.forecastDailySum),
    absErrorSum: toNumber(row.absErrorSum),
  }));
}

async function loadDataQuality(input: {
  platform?: string;
  start?: YearMonth;
  end?: YearMonth;
}): Promise<ForecastAccuracyDataQuality> {
  const monthlyFilters = buildMonthFilters({
    platform: input.platform,
    start: input.start,
    end: input.end,
    alias: 'm',
  });

  const [monthlyRow] = rowsOf<{
    monthlyRows?: number | string | null;
    monthlySkuCount?: number | string | null;
    monthlyStartMonth?: string | null;
    monthlyEndMonth?: string | null;
    unknownChannelRows?: number | string | null;
    unknownChannelQty?: number | string | null;
    totalMonthlyQty?: number | string | null;
  }>(
    await db.execute(sql`
      select
        count(*)::int as "monthlyRows",
        count(distinct m.sku_id)::int as "monthlySkuCount",
        min(format('%s-%s', m.sale_year, lpad(m.month::text, 2, '0'))) as "monthlyStartMonth",
        max(format('%s-%s', m.sale_year, lpad(m.month::text, 2, '0'))) as "monthlyEndMonth",
        count(*) filter (where m.channel is null or btrim(m.channel) = '' or upper(m.channel) = 'UNKNOWN')::int as "unknownChannelRows",
        coalesce(sum(m.qty_sold) filter (where m.channel is null or btrim(m.channel) = '' or upper(m.channel) = 'UNKNOWN'), 0)::float8 as "unknownChannelQty",
        coalesce(sum(m.qty_sold), 0)::float8 as "totalMonthlyQty"
      from sales_history_monthly m
      ${whereClause(monthlyFilters)}
    `),
  );

  const dailyFilters = buildMonthFilters({
    platform: input.platform,
    start: input.start,
    end: input.end,
    alias: 'd',
  });

  const [reconcileRow] = rowsOf<{
    comparedRows?: number | string | null;
    comparedMonths?: number | string | null;
    absDiffQty?: number | string | null;
    baseQty?: number | string | null;
  }>(
    await db.execute(sql`
      with d_all as (
        select
          d.sku_id,
          upper(coalesce(d.channel, 'UNKNOWN')) as channel,
          extract(year from d.sale_date)::int as sale_year,
          extract(month from d.sale_date)::int as month,
          (extract(year from d.sale_date)::int * 100 + extract(month from d.sale_date)::int) as ym,
          sum(d.qty_sold)::numeric as daily_qty
        from sales_history d
        ${whereClause(dailyFilters)}
        group by
          d.sku_id,
          upper(coalesce(d.channel, 'UNKNOWN')),
          extract(year from d.sale_date)::int,
          extract(month from d.sale_date)::int
      ), m_all as (
        select
          m.sku_id,
          upper(coalesce(m.channel, 'UNKNOWN')) as channel,
          m.sale_year,
          m.month,
          (m.sale_year * 100 + m.month) as ym,
          sum(m.qty_sold)::numeric as monthly_qty
        from sales_history_monthly m
        ${whereClause(monthlyFilters)}
        group by m.sku_id, upper(coalesce(m.channel, 'UNKNOWN')), m.sale_year, m.month
      ), bounds as (
        select
          greatest(
            coalesce((select min(ym) from m_all), 999999),
            coalesce((select min(ym) from d_all), 999999)
          ) as min_ym,
          least(
            coalesce((select max(ym) from m_all), 0),
            coalesce((select max(ym) from d_all), 0)
          ) as max_ym
      ), d as (
        select d_all.*
        from d_all, bounds
        where bounds.min_ym <= bounds.max_ym
          and d_all.ym between bounds.min_ym and bounds.max_ym
      ), m as (
        select m_all.*
        from m_all, bounds
        where bounds.min_ym <= bounds.max_ym
          and m_all.ym between bounds.min_ym and bounds.max_ym
      )
      select
        count(*)::int as "comparedRows",
        count(distinct format('%s-%s', coalesce(m.sale_year, d.sale_year), lpad(coalesce(m.month, d.month)::text, 2, '0')))::int as "comparedMonths",
        coalesce(sum(abs(coalesce(m.monthly_qty, 0) - coalesce(d.daily_qty, 0))), 0)::float8 as "absDiffQty",
        coalesce(sum(coalesce(m.monthly_qty, 0)), 0)::float8 as "baseQty"
      from m
      full outer join d on d.sku_id = m.sku_id
        and d.channel = m.channel
        and d.sale_year = m.sale_year
        and d.month = m.month
    `),
  );

  const totalMonthlyQty = toNumber(monthlyRow?.totalMonthlyQty);
  const unknownChannelQty = toNumber(monthlyRow?.unknownChannelQty);
  const dailyMonthlyBaseQty = toNumber(reconcileRow?.baseQty);
  const dailyMonthlyAbsDiffQty = toNumber(reconcileRow?.absDiffQty);

  return {
    monthlyRows: toInt(monthlyRow?.monthlyRows),
    monthlySkuCount: toInt(monthlyRow?.monthlySkuCount),
    monthlyStartMonth: monthlyRow?.monthlyStartMonth ?? undefined,
    monthlyEndMonth: monthlyRow?.monthlyEndMonth ?? undefined,
    unknownChannelRows: toInt(monthlyRow?.unknownChannelRows),
    unknownChannelQty,
    totalMonthlyQty,
    unknownChannelQtyRate: totalMonthlyQty > 0 ? unknownChannelQty / totalMonthlyQty : null,
    dailyMonthlyComparedRows: toInt(reconcileRow?.comparedRows),
    dailyMonthlyComparedMonths: toInt(reconcileRow?.comparedMonths),
    dailyMonthlyAbsDiffQty,
    dailyMonthlyBaseQty,
    dailyMonthlyAbsDiffRate: dailyMonthlyBaseQty > 0 ? dailyMonthlyAbsDiffQty / dailyMonthlyBaseQty : null,
  };
}

function buildRecommendations(input: {
  dataQuality: ForecastAccuracyDataQuality;
  global: ForecastAccuracyMetricSummary;
  byProfileSegment: ForecastAccuracyMetricSummary[];
  byVolumeTier: ForecastAccuracyMetricSummary[];
  byHorizonBand: ForecastAccuracyMetricSummary[];
}): string[] {
  const recs: string[] = [];
  const { dataQuality, global } = input;
  const ghostRate = global.rows > 0 ? global.ghostRows / global.rows : 0;
  const zeroMissRate = global.comparableRows > 0 ? global.zeroForecastMissRows / global.comparableRows : 0;

  if ((dataQuality.unknownChannelQtyRate ?? 0) > 0.05) {
    recs.push('先治理渠道/平台映射：UNKNOWN 渠道销量占比超过 5%，会直接干扰平台级预测与回测口径。');
  }
  if ((dataQuality.dailyMonthlyAbsDiffRate ?? 0) > 0.01) {
    recs.push('先做日表/月表对账：日销量聚合与月表差异超过 1%，准确率指标可能被导入口径污染。');
  }
  if (global.wmape != null && global.wmape > 0.3) {
    recs.push('不要用全库统一点预测做目标：当前全局 WMAPE 偏高，应按主力/腰部/长尾与 A/B/C/D 画像分层设 KPI。');
  }
  if (global.weightedBias != null && global.weightedBias > 0.1) {
    recs.push('存在系统性高估：加权 Bias 超过 +10%，优先下调长尾与 D 类下限预测，避免 ghost 库存。');
  }
  if (global.weightedBias != null && global.weightedBias < -0.1) {
    recs.push('存在系统性低估：加权 Bias 低于 -10%，优先检查零预测漏报、新品准入与促销/广告特征缺失。');
  }
  if (ghostRate > 0.05) {
    recs.push('ghost 行占比偏高：actual=0 但 forecast>0 的 SKU 需要生命周期/下架/断货/渠道停售信号。');
  }
  if (zeroMissRate > 0.03) {
    recs.push('零预测漏报偏高：actual>0 但 forecast=0 的 SKU 需要 force_forecast、新品冷启动或近 30/90 天准入规则。');
  }

  const worstSegment = input.byProfileSegment
    .filter((row) => row.comparableRows >= 30 && row.wmape != null)
    .sort((a, b) => (b.wmape ?? 0) - (a.wmape ?? 0))[0];
  if (worstSegment && (worstSegment.wmape ?? 0) > 0.35) {
    recs.push(`优先专项优化 ${worstSegment.label ?? worstSegment.key}：该层 WMAPE 最高，应单独调整模型/人工复核阈值。`);
  }

  const tail = input.byVolumeTier.find((row) => row.key === 'tail');
  if (tail?.wmape != null && tail.wmape > 0.4) {
    recs.push('长尾 SKU 点预测不稳定：建议改为品类池预测 + 安全库存下限管理，不纳入主 KPI。');
  }

  const precision = input.byHorizonBand.find((row) => row.key?.startsWith('precision|'));
  if (precision?.wmape != null && precision.wmape > 0.25) {
    recs.push('近端 1–3 月预测仍偏高：应补充缺货、促销、价格、广告等外生特征，并建立人工协同修正队列。');
  }

  if (!recs.length) {
    recs.push('当前基础指标未触发高风险阈值；建议保持按月走步回测，并把主力/腰部 SKU 作为预测准确率主 KPI。');
  }
  return recs;
}

export async function buildForecastAccuracyDiagnostics(
  rawInput: ForecastAccuracyDiagnosticsInput = {},
): Promise<ForecastAccuracyDiagnostics> {
  const station = normalizeCode(rawInput.station);
  const platform = normalizeCode(rawInput.platform);
  const start = parseYearMonth(rawInput.startMonth, 'startMonth');
  const end = parseYearMonth(rawInput.endMonth, 'endMonth');
  const asOf = parseYearMonth(rawInput.asOf, 'asOf');
  if (start && end && start.serial > end.serial) {
    throw new Error('startMonth must be less than or equal to endMonth');
  }

  let version: VersionScopeRow | null = null;
  let versionSelection: ForecastAccuracyDiagnosticScope['versionSelection'] = 'auto_latest';
  if (rawInput.versionId?.trim()) {
    version = await loadVersionById(rawInput.versionId.trim());
    if (!version) throw new Error(`Forecast version not found: ${rawInput.versionId}`);
    versionSelection = 'explicit';
  } else if (rawInput.versionName?.trim()) {
    version = await loadVersionByName(rawInput.versionName.trim());
    if (!version) throw new Error(`Forecast version not found: ${rawInput.versionName}`);
    versionSelection = 'explicit';
  } else {
    version = await loadLatestAccuracyVersion({ station, platform, start, end });
    versionSelection = version?.status === 'published' ? 'auto_published' : 'auto_latest';
  }

  const filters = buildAccuracyFilters({
    versionId: version?.id,
    station,
    platform,
    start,
    end,
  });
  const horizonRef = asOf ?? start;
  const limitTopErrors = Math.max(1, Math.min(200, Math.floor(rawInput.limitTopErrors ?? 20)));

  const [dataQuality, global, byHorizonBand, byProfileSegment, byVolumeTier, byCategory, topErrorSkus] =
    await Promise.all([
      loadDataQuality({ platform, start, end }),
      loadGlobalMetrics(filters, horizonRef),
      loadGroupedMetrics({
        filters,
        horizonRef,
        dimensionSql: sql`coalesce(nullif(horizon_band, ''), 'unknown') || '|' || coalesce(nullif(profile_segment, ''), 'unclassified')`,
        labelForKey: horizonProfileLabel,
        limit: 48,
        orderBySql: sql`
          case split_part(keyed.dim_key, '|', 1)
            when 'precision' then 1
            when 'flex' then 2
            when 'strategic' then 3
            else 9
          end,
          split_part(keyed.dim_key, '|', 2)
        `,
      }),
      loadGroupedMetrics({
        filters,
        horizonRef,
        dimensionSql: sql`coalesce(nullif(profile_segment, ''), 'unclassified')`,
        labelForKey: profileSegmentLabel,
        limit: 30,
      }),
      loadGroupedMetrics({
        filters,
        horizonRef,
        dimensionSql: sql`volume_tier`,
        labelForKey: (key) => VOLUME_TIER_LABELS[key] ?? key,
        limit: 10,
      }),
      loadGroupedMetrics({
        filters,
        horizonRef,
        dimensionSql: sql`coalesce(nullif(category, ''), '(无品类)')`,
        limit: 20,
        minComparableRows: 10,
      }),
      loadTopErrorSkus({ filters, horizonRef, limit: limitTopErrors }),
    ]);

  const scope: ForecastAccuracyDiagnosticScope = {
    versionId: version?.id,
    versionName: version?.versionName,
    versionStatus: version?.status,
    versionStation: version?.station,
    versionSelection,
    station,
    platform,
    startMonth: start?.key ?? global.minForecastMonth,
    endMonth: end?.key ?? global.maxForecastMonth,
    asOf: asOf?.key,
  };

  const recommendations = buildRecommendations({
    dataQuality,
    global,
    byProfileSegment,
    byVolumeTier,
    byHorizonBand,
  });

  return {
    scope,
    dataQuality,
    global,
    byHorizonBand,
    byProfileSegment,
    byVolumeTier,
    byCategory,
    topErrorSkus,
    recommendations,
  };
}

function pct(value: number | null | undefined, digits = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function num(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: digits });
}

function metricLine(row: ForecastAccuracyMetricSummary): string {
  return `${row.label ?? row.key ?? '全量'}：${row.skuCount} SKU · KPI 可比 ${row.comparableRows}/${row.rows} 行 · 月均 MAPE ${pct(row.weightedBias)} · 月均 WMAPE ${pct(row.wmape)} · ghost ${row.ghostRows} · 漏报 ${row.zeroForecastMissRows}`;
}

type ReviewQueueCandidateSqlRow = {
  skuId: string;
  skuCode: string;
  skuName: string;
  station: string;
  platform: string;
  rows?: number | string | null;
  comparableRows?: number | string | null;
  wmape?: number | string | null;
  weightedBias?: number | string | null;
  ghostRows?: number | string | null;
  zeroForecastMissRows?: number | string | null;
  actualDailySum?: number | string | null;
  forecastDailySum?: number | string | null;
  worstMonth?: string | null;
};

async function resolveAccuracySourceVersion(input: {
  sourceVersionId?: string;
  sourceVersionName?: string;
  station?: string;
  platform?: string;
  start?: YearMonth;
  end?: YearMonth;
}): Promise<VersionScopeRow> {
  if (input.sourceVersionId?.trim()) {
    const version = await loadVersionById(input.sourceVersionId.trim());
    if (!version) throw new Error(`Forecast version not found: ${input.sourceVersionId}`);
    return version;
  }
  if (input.sourceVersionName?.trim()) {
    const version = await loadVersionByName(input.sourceVersionName.trim());
    if (!version) throw new Error(`Forecast version not found: ${input.sourceVersionName}`);
    return version;
  }
  const version = await loadLatestAccuracyVersion({
    station: input.station,
    platform: input.platform,
    start: input.start,
    end: input.end,
  });
  if (!version) throw new Error('No forecast accuracy version found for diagnostics review queue');
  return version;
}

function reviewQueueSeverity(row: ReviewQueueCandidateSqlRow): 'critical' | 'warning' {
  const wmape = capSkuWmapeForStats(toNullableNumber(row.wmape)) ?? 0;
  const bias = Math.abs(toNullableNumber(row.weightedBias) ?? 0);
  const ghostRows = toInt(row.ghostRows);
  const zeroMissRows = toInt(row.zeroForecastMissRows);
  return wmape >= 0.8 || bias >= 0.5 || ghostRows >= 2 || zeroMissRows >= 2
    ? 'critical'
    : 'warning';
}

function reviewQueueMessage(input: {
  sourceVersionName: string;
  startMonth?: string;
  endMonth?: string;
  row: ReviewQueueCandidateSqlRow;
}): string {
  const wmape = capSkuWmapeForStats(toNullableNumber(input.row.wmape));
  const bias = toNullableNumber(input.row.weightedBias);
  const actualDailySum = toNumber(input.row.actualDailySum);
  const comparableRows = toInt(input.row.comparableRows);
  const referenceDailyAvg = comparableRows > 0 ? actualDailySum / comparableRows : null;
  const range = input.startMonth || input.endMonth
    ? `${input.startMonth ?? '最早'}~${input.endMonth ?? '最晚'}`
    : '已回测月份';
  return [
    `${input.row.skuCode} 准确率诊断异常，来源版本「${input.sourceVersionName}」${range}`,
    `WMAPE ${wmape == null ? '—' : `${(wmape * 100).toFixed(1)}%`}`,
    `Bias ${bias == null ? '—' : `${(bias * 100).toFixed(1)}%`}`,
    `ghost ${toInt(input.row.ghostRows)}`,
    `零预测漏报 ${toInt(input.row.zeroForecastMissRows)}`,
    referenceDailyAvg == null ? '请复核未来预测' : `建议参考实际日均 ${referenceDailyAvg.toFixed(2)} 复核未来预测`,
  ].join('；');
}

export async function createForecastAccuracyReviewQueue(
  rawInput: ForecastAccuracyReviewQueueInput,
): Promise<ForecastAccuracyReviewQueueResult> {
  const targetVersionId = rawInput.targetVersionId?.trim();
  if (!targetVersionId) throw new Error('targetVersionId is required');

  const targetVersion = await loadVersionById(targetVersionId);
  if (!targetVersion) throw new Error(`Target forecast version not found: ${targetVersionId}`);
  if (targetVersion.status !== 'draft') {
    throw new Error('Only draft forecast version can receive accuracy review queue items');
  }

  const station = normalizeCode(rawInput.station);
  const platform = normalizeCode(rawInput.platform);
  const start = parseYearMonth(rawInput.startMonth, 'startMonth');
  const end = parseYearMonth(rawInput.endMonth, 'endMonth');
  if (start && end && start.serial > end.serial) {
    throw new Error('startMonth must be less than or equal to endMonth');
  }

  const sourceVersion = await resolveAccuracySourceVersion({
    sourceVersionId: rawInput.sourceVersionId,
    sourceVersionName: rawInput.sourceVersionName,
    station,
    platform,
    start,
    end,
  });

  const limit = Math.max(1, Math.min(200, Math.floor(rawInput.limit ?? 50)));
  const minWmape = Math.max(0, Math.min(10, rawInput.minWmape ?? 0.3));
  const filters = buildAccuracyFilters({
    versionId: sourceVersion.id,
    station,
    platform,
    start,
    end,
  });

  const candidatesResult = await db.execute(sql`
    with base as (
      select
        fa.sku_id,
        s.code as sku_code,
        s.name as sku_name,
        fa.station,
        fa.platform,
        fa.forecast_year,
        fa.month,
        fa.forecast_daily_avg::numeric as forecast_daily,
        fa.actual_daily_avg::numeric as actual_daily,
        (fa.forecast_daily_avg::numeric - fa.actual_daily_avg::numeric) as error,
        abs(fa.forecast_daily_avg::numeric - fa.actual_daily_avg::numeric) as abs_error
      from forecast_accuracy_monthly fa
      join skus s on s.id = fa.sku_id
      join (
        select distinct sku_id, station, platform
        from sales_forecast_monthly
        where version_id = ${targetVersionId}::uuid
      ) target_forecast on target_forecast.sku_id = fa.sku_id
        and target_forecast.station = fa.station
        and target_forecast.platform = fa.platform
      ${whereClause(filters)}
    ), scored as (
      select
        sku_id as "skuId",
        sku_code as "skuCode",
        sku_name as "skuName",
        station,
        platform,
        count(*)::int as rows,
        count(*) filter (where actual_daily > 0)::int as "comparableRows",
        (
          select avg(month_wmape)::float8
          from (
            select
              forecast_year,
              month,
              sum(abs_error) filter (where actual_daily > 0)
                / nullif(sum(actual_daily) filter (where actual_daily > 0), 0) as month_wmape
            from base b2
            where b2.sku_id = base.sku_id
              and b2.station = base.station
              and b2.platform = base.platform
            group by forecast_year, month
            having sum(actual_daily) filter (where actual_daily > 0) > 0
          ) monthly_wmape
        ) as wmape,
        (
          select avg(month_bias)::float8
          from (
            select
              forecast_year,
              month,
              sum(error) filter (where actual_daily > 0)
                / nullif(sum(actual_daily) filter (where actual_daily > 0), 0) as month_bias
            from base b3
            where b3.sku_id = base.sku_id
              and b3.station = base.station
              and b3.platform = base.platform
            group by forecast_year, month
            having sum(actual_daily) filter (where actual_daily > 0) > 0
          ) monthly_bias
        ) as "weightedBias",
        count(*) filter (where actual_daily = 0 and forecast_daily > 0)::int as "ghostRows",
        count(*) filter (where actual_daily > 0 and forecast_daily = 0)::int as "zeroForecastMissRows",
        coalesce(sum(actual_daily) filter (where actual_daily > 0), 0)::float8 as "actualDailySum",
        coalesce(sum(forecast_daily) filter (where actual_daily > 0), 0)::float8 as "forecastDailySum",
        (array_agg(format('%s-%s', forecast_year, lpad(month::text, 2, '0')) order by abs_error desc))[1] as "worstMonth"
      from base
      group by sku_id, sku_code, sku_name, station, platform
    )
    select *
    from scored
    where coalesce(wmape, 0) >= ${minWmape}
      or "ghostRows" > 0
      or "zeroForecastMissRows" > 0
    order by
      coalesce(wmape, 0) desc,
      ("ghostRows" + "zeroForecastMissRows") desc,
      "actualDailySum" desc
    limit ${limit}
  `);

  const candidates = rowsOf<ReviewQueueCandidateSqlRow>(candidatesResult);
  let upserted = 0;
  let skippedCompleted = 0;

  const items: ForecastAccuracyReviewQueueResult['items'] = [];
  for (const row of candidates) {
    const severity = reviewQueueSeverity(row);
    const comparableRows = toInt(row.comparableRows);
    const suggestedDailyAvg = comparableRows > 0 ? toNumber(row.actualDailySum) / comparableRows : null;
    const message = reviewQueueMessage({
      sourceVersionName: sourceVersion.versionName,
      startMonth: start?.key,
      endMonth: end?.key,
      row,
    });

    const upsertResult = await db.execute(sql`
      insert into sales_forecast_review_items (
        version_id,
        sku_id,
        station,
        platform,
        issue_type,
        severity,
        message,
        suggested_daily_avg
      ) values (
        ${targetVersionId}::uuid,
        ${row.skuId}::uuid,
        ${row.station},
        ${row.platform},
        'low_accuracy',
        ${severity},
        ${message},
        ${suggestedDailyAvg == null ? null : String(suggestedDailyAvg)}::numeric
      )
      on conflict (version_id, sku_id, station, platform, issue_type)
      do update set
        severity = excluded.severity,
        message = excluded.message,
        suggested_daily_avg = excluded.suggested_daily_avg
      where sales_forecast_review_items.status = 'pending'
      returning id
    `);
    const affected = rowsOf<{ id: string }>(upsertResult).length;
    if (affected > 0) upserted += affected;
    else skippedCompleted++;

    items.push({
      skuId: row.skuId,
      skuCode: row.skuCode,
      skuName: row.skuName,
      station: row.station,
      platform: row.platform,
      severity,
      wmape: capSkuWmapeForStats(toNullableNumber(row.wmape)),
      weightedBias: toNullableNumber(row.weightedBias),
      ghostRows: toInt(row.ghostRows),
      zeroForecastMissRows: toInt(row.zeroForecastMissRows),
      suggestedDailyAvg,
    });
  }

  return {
    sourceVersion: {
      id: sourceVersion.id,
      versionName: sourceVersion.versionName,
      status: sourceVersion.status,
    },
    targetVersion: {
      id: targetVersion.id,
      versionName: targetVersion.versionName,
      status: targetVersion.status,
    },
    candidates: candidates.length,
    upserted,
    skippedCompleted,
    items,
  };
}
export function formatForecastAccuracyDiagnosticsMarkdown(
  diagnostics: ForecastAccuracyDiagnostics,
): string {
  const lines: string[] = [];
  lines.push('## 预测准确率诊断');
  lines.push('');
  lines.push(`- 版本：${diagnostics.scope.versionName ?? diagnostics.scope.versionId ?? '未指定'}${diagnostics.scope.versionStatus ? `（${diagnostics.scope.versionStatus}）` : ''}`);
  lines.push(`- 版本选择：${diagnostics.scope.versionSelection ?? '—'}`);
  lines.push(`- 范围：${diagnostics.scope.startMonth ?? '—'} ~ ${diagnostics.scope.endMonth ?? '—'}；站点 ${diagnostics.scope.station ?? 'ALL'}；平台 ${diagnostics.scope.platform ?? 'ALL'}`);
  lines.push('');
  lines.push('### 全局准确率');
  lines.push(`- ${metricLine(diagnostics.global)}`);
  lines.push('');
  lines.push('### 数据质量');
  lines.push(`- 月表：${num(diagnostics.dataQuality.monthlyRows)} 行，${num(diagnostics.dataQuality.monthlySkuCount)} SKU，覆盖 ${diagnostics.dataQuality.monthlyStartMonth ?? '—'} ~ ${diagnostics.dataQuality.monthlyEndMonth ?? '—'}`);
  lines.push(`- UNKNOWN 渠道：${num(diagnostics.dataQuality.unknownChannelQty)} 件，占比 ${pct(diagnostics.dataQuality.unknownChannelQtyRate)}`);
  lines.push(`- 日/月对账差异：${num(diagnostics.dataQuality.dailyMonthlyAbsDiffQty)} 件，占比 ${pct(diagnostics.dataQuality.dailyMonthlyAbsDiffRate)}（对账行 ${num(diagnostics.dataQuality.dailyMonthlyComparedRows)}）`);
  lines.push('');
  lines.push('### 分层表现');
  lines.push('- 决策窗口 × 画像：');
  for (const row of diagnostics.byHorizonBand) lines.push(`  - ${metricLine(row)}`);
  lines.push('- 销量层：');
  for (const row of diagnostics.byVolumeTier) lines.push(`  - ${metricLine(row)}`);
  lines.push('- 画像层 Top：');
  for (const row of diagnostics.byProfileSegment.slice(0, 8)) lines.push(`  - ${metricLine(row)}`);
  lines.push('');
  lines.push('### 误差贡献 Top SKU');
  for (const sku of diagnostics.topErrorSkus.slice(0, 10)) {
    lines.push(`- ${sku.skuCode}：WMAPE ${pct(sku.wmape)} · Bias ${pct(sku.weightedBias)} · absError ${num(sku.absErrorSum, 2)} · ${sku.profileSegment}/${sku.volumeTier}`);
  }
  lines.push('');
  lines.push('### 建议');
  diagnostics.recommendations.forEach((rec, index) => lines.push(`${index + 1}. ${rec}`));
  return lines.join('\n');
}


