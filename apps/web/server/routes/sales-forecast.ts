import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import {
  db,
  salesForecastMonthly,
  salesForecastReviewItems,
  salesForecastSeasonality,
  forecastPromoCalendar,
  skus,
} from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { isForecastWriteRoleCode, requireMenu, resolveRequestUser } from '../lib/rbac.js';
import { writeAuditLog } from '../lib/audit-log.js';
import { formatForecastMonth, mapForecastDailyFields } from '../lib/forecast-demand.js';
import { resolveSalesPlatformCode, listActiveSalesPlatforms } from '../lib/sales-platform.js';
import { countBaselineForecastPlatforms, isForecastV41PlatformCode, resolveBaselineForecastPlatforms } from '../lib/forecast-platform-scope.js';
import {
  getOrCreateDraftVersion,
  publishForecastVersion,
  archiveForecastVersion,
  listForecastVersions,
  listForecastVersionsWithStats,
  getForecastVersionWithStats,
  assertVersionIsDraft,
  getPrimaryPublishedVersionId,
  getForecastVersionById,
  getLatestDraftVersion,
} from '../lib/forecast-version.js';
import { buildBaselineDraftVersionName } from '../lib/forecast-version-label.js';
import {
  validateForecastRows,
  hasBlockingForecastIssues,
  type ForecastRowInput,
} from '../lib/forecast-validation.js';
import { listForecastAccuracy, computeForecastAccuracyBacktest, summarizeForecastAccuracy, buildForecastAccuracyExportCsv, buildForecastAccuracySkuExportCsv } from '../lib/forecast-accuracy.js';
import {
  buildForecastAccuracyDiagnostics,
  createForecastAccuracyReviewQueue,
} from '../lib/forecast-accuracy-diagnostics.js';
import { runWalkForwardAccuracyBacktest } from '../lib/forecast-walkforward-backtest.js';
import { csvAttachment } from '../lib/csv-export.js';
import {
  buildForecastReviewSummary,
  buildForecastAccuracyDigest,
} from '../lib/forecast-agent.js';
import { buildForecastImpactPreview, compareForecastDemandChange } from '../lib/forecast-impact.js';
import { generateBaselineForecastVersion } from '../lib/forecast-collaboration.js';
import { runDifySingleSkuForecast } from '../lib/forecast-dify-single.js';
import { normalizeForecastExogenousInput } from '../lib/forecast-exogenous-input.js';
import { isSalesForecastWorkflowEnabled } from '../integrations/dify.js';
import {
  aggregateSalesHistoryMonthlyFromDaily,
  computeWalkForwardAsOf,
  getMonthlySalesCoverageStats,
} from '../lib/sales-history-monthly.js';
import {
  runBaselineForecastTask,
  parseBaselineTaskResult,
} from '../lib/forecast-baseline-task.js';
import { getTaskRunById, startTaskRun } from '../lib/task-runs.js';
import { countActiveSkusForForecast, searchSkuCategories } from '../lib/sku-category.js';
import {
  batchProcessReviewItems,
  clearReviewItems,
  getReviewItemStats,
  listGroupedReviewItems,
  updateReviewItemsStatus,
} from '../lib/forecast-review-actions.js';
import { rebuildSeasonalityFromSalesHistoryMonthly } from '../lib/forecast-seasonality-rebuild.js';
import { listSeasonalityHorizon } from '../lib/forecast-seasonality-horizon.js';
import { listForecastHorizon } from '../lib/forecast-horizon.js';
import { clearAllForecastData } from '../lib/forecast-reset.js';
import {
  buildSkuForecastContextMap,
  buildSkuMonthlyForecastMap,
  getVersionForecastSummary,
} from '../lib/forecast-sku-context.js';
import { MAX_FORECAST_MONTH_COUNT } from '../lib/forecast-limits.js';

export const salesForecastRoutes = new Hono();

const REVIEW_STATUSES = ['pending', 'reviewed', 'ignored'] as const;
const REVIEW_SEVERITIES = ['critical', 'warning', 'info'] as const;
const SEASONALITY_DIMENSION_TYPES = ['category', 'project_group'] as const;
const FORECAST_VERSION_STATUSES = ['draft', 'published', 'archived'] as const;
const CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;

const MIN_BASELINE_MONTH_COUNT = 1;
const MAX_BASELINE_MONTH_COUNT = MAX_FORECAST_MONTH_COUNT;
const MAX_BASELINE_FORECAST_ROWS = 50_000;

function isOneOf<T extends readonly string[]>(value: string | undefined, values: T): value is T[number] {
  return value !== undefined && values.includes(value);
}

function numericOrNull(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numericPatchValue(value: unknown): string | undefined {
  if (value == null) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? String(parsed) : undefined;
}

import { parseListPagination } from '../lib/list-pagination.js';

function parseOptionalIntegerQuery(
  value: string | undefined,
  name: string,
  options?: { min?: number; max?: number },
): { value?: number; error?: string } {
  if (value === undefined || value === '') return {};
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return { error: `${name} must be an integer` };
  if (options?.min !== undefined && parsed < options.min) {
    return { error: `${name} must be at least ${options.min}` };
  }
  if (options?.max !== undefined && parsed > options.max) {
    return { error: `${name} must be at most ${options.max}` };
  }
  return { value: parsed };
}

function parseOptionalFiniteNumber(
  value: unknown,
  name: string,
): { value?: number; error?: string } {
  if (value === undefined) return {};
  if (value === null || value === '') return { error: `${name} must be a finite number` };
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return { error: `${name} must be a finite number` };
  return { value: parsed };
}

function parseOptionalPositiveNumber(
  value: unknown,
  name: string,
): { value?: number; error?: string } {
  const parsed = parseOptionalFiniteNumber(value, name);
  if (parsed.error) return parsed;
  if (parsed.value !== undefined && parsed.value < 0) {
    return { error: `${name} must be greater than or equal to 0` };
  }
  return parsed;
}

async function requireForecastWrite(c: Context, next: Next) {
  const user = await resolveRequestUser(c);
  if (!user) return c.json({ message: 'Unauthorized' }, 401);
  c.set('user', user);

  if (!isForecastWriteRoleCode(user.role.code)) {
    return c.json({ message: 'Forbidden' }, 403);
  }

  return next();
}

async function countActiveSkus(input: { category?: string; skuCode?: string }): Promise<number> {
  return countActiveSkusForForecast(input);
}

function mapReviewItemRow(row: {
  id: string;
  versionId: string;
  skuId: string;
  skuCode: string;
  skuName?: string;
  station: string;
  platform: string;
  issueType: string;
  severity: string;
  message: string;
  suggestedDailyAvg?: string | null;
  reviewedDailyAvg?: string | null;
  status: string;
  createdAt: Date;
}) {
  return {
    ...row,
    suggestedDailyAvg: numericOrNull(row.suggestedDailyAvg),
    reviewedDailyAvg: numericOrNull(row.reviewedDailyAvg),
  };
}

function mapForecastRow(row: {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  station: string;
  platform: string;
  forecastYear: number;
  month: number;
  forecastDailyAvg: string;
  baselineDailyAvg?: string | null;
  manualDailyAvg?: string | null;
  adjustReason?: string | null;
  confidenceLevel?: string | null;
  lifecycle?: string | null;
  ownerName?: string | null;
  source: string;
  versionId?: string | null;
  updatedAt: Date;
}) {
  const daily = mapForecastDailyFields({
    forecastDailyAvg: row.forecastDailyAvg,
    manualDailyAvg: row.manualDailyAvg,
  });
  return {
    ...row,
    forecastMonth: formatForecastMonth(row.forecastYear, row.month),
    forecastDailyAvg: daily.forecastDailyAvg,
    manualDailyAvg: daily.manualDailyAvg,
    effectiveDailyAvg: daily.effectiveDailyAvg,
    baselineDailyAvg: row.baselineDailyAvg != null ? Number(row.baselineDailyAvg) : null,
  };
}

async function loadVersionRows(versionId: string): Promise<ForecastRowInput[]> {
  const rows = await db
    .select({
      skuId: salesForecastMonthly.skuId,
      skuCode: skus.code,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      manualDailyAvg: salesForecastMonthly.manualDailyAvg,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .where(eq(salesForecastMonthly.versionId, versionId));

  return rows.map((r) => {
    const daily = mapForecastDailyFields({
      forecastDailyAvg: r.forecastDailyAvg,
      manualDailyAvg: r.manualDailyAvg,
    });
    return {
      skuId: r.skuId,
      skuCode: r.skuCode,
      station: r.station,
      platform: r.platform,
      forecastYear: r.forecastYear,
      month: r.month,
      forecastDailyAvg: daily.effectiveDailyAvg,
    };
  });
}

salesForecastRoutes.get('/sales-platforms', requireMenu('data.forecast'), async (c) => {
  const station = c.req.query('station')?.trim();
  const rows = await listActiveSalesPlatforms(station);
  return c.json(rows);
});

salesForecastRoutes.get('/sales-forecast/stations', requireMenu('data.forecast'), async (c) => {
  return c.json(await listSalesStations());
});

salesForecastRoutes.get('/sales-forecast/categories', requireMenu('data.forecast'), async (c) => {
  const q = c.req.query('q')?.trim();
  const limitRaw = Number.parseInt(c.req.query('limit')?.trim() ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  return c.json(await searchSkuCategories(q || undefined, limit));
});

salesForecastRoutes.post('/sales-forecasts/generate-baseline', requireMenu('data.forecast'), requireForecastWrite, async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    station?: string;
    platform?: string;
    category?: string;
    skuCode?: string;
    versionName?: string;
    targetVersionId?: string;
    monthCount?: number;
    background?: boolean;
  }>();

  const monthCount = body.monthCount ?? 12;
  if (
    !Number.isInteger(monthCount) ||
    monthCount < MIN_BASELINE_MONTH_COUNT ||
    monthCount > MAX_BASELINE_MONTH_COUNT
  ) {
    return c.json(
      {
        message: `monthCount must be an integer between ${MIN_BASELINE_MONTH_COUNT} and ${MAX_BASELINE_MONTH_COUNT}`,
      },
      400,
    );
  }
  const skuCode = body.skuCode?.trim() || undefined;
  const perStationSkuCount = await countActiveSkus({ category: body.category?.trim(), skuCode });
  const activeSkuCount = perStationSkuCount;
  if (skuCode && activeSkuCount === 0) {
    return c.json({ message: `SKU ${skuCode} 不存在、未启用，或与所选品类不匹配` }, 404);
  }
  const platform = body.platform?.trim() || 'ALL';
  const baselinePlatforms = resolveBaselineForecastPlatforms(platform);
  if (baselinePlatforms.length === 1 && !isForecastV41PlatformCode(baselinePlatforms[0]!)) {
    return c.json(
      {
        message: `渠道「${platform}」暂不支持单渠道预测，请选择全平台汇总或亚马逊/沃尔玛/Temu/TikTok`,
      },
      400,
    );
  }
  const estimatedForecastRows =
    activeSkuCount * monthCount * countBaselineForecastPlatforms(platform);
  const useBackground =
    !skuCode && (body.background === true || estimatedForecastRows > MAX_BASELINE_FORECAST_ROWS);

  const category = body.category?.trim() || undefined;
  const versionName = body.versionName?.trim();
  const targetVersionId = body.targetVersionId?.trim() || undefined;
  const autoVersionName = buildBaselineDraftVersionName({
    monthCount,
    platform,
    category,
    skuCode,
  });

  let existingVersionId: string | undefined;
  let forceNewVersion: boolean;
  if (skuCode) {
    forceNewVersion = false;
    if (targetVersionId) {
      const target = await getForecastVersionById(targetVersionId);
      if (!target) return c.json({ message: '目标草稿版本不存在' }, 404);
      if (target.status !== 'draft') {
        return c.json({ message: '仅可向草稿版本写入单 SKU 预测' }, 400);
      }
      existingVersionId = targetVersionId;
    } else {
      const latestDraft = await getLatestDraftVersion();
      existingVersionId = latestDraft?.id;
    }
  } else {
    forceNewVersion = true;
    existingVersionId = undefined;
  }

  const taskInput = {
    platform,
    category,
    skuCode,
    versionName: versionName ?? autoVersionName,
    monthCount,
    createdBy: user.id,
    existingVersionId,
    forceNewVersion,
  };

  if (useBackground) {
    const run = await startTaskRun('forecast_baseline', user.id);
    void runBaselineForecastTask(run.id, taskInput).catch((err) => {
      console.error('[forecast] background baseline task error:', err);
    });
    return c.json(
      {
        async: true,
        taskRunId: run.id,
        status: 'running',
        activeSkuCount,
        monthCount,
        estimatedForecastRows,
        maxForecastRows: MAX_BASELINE_FORECAST_ROWS,
        platformCount: countBaselineForecastPlatforms(platform),
      },
      202,
    );
  }

  const result = await generateBaselineForecastVersion(taskInput);

  await writeAuditLog(c, {
    action: 'sales_forecast.generate_baseline',
    resourceType: 'sales_forecast_version',
    resourceId: result.version.id,
    detail: { forecastRows: result.forecastRows, reviewRows: result.reviewRows },
    user,
  });

  return c.json({
    async: false,
    version: result.version,
    forecastRows: result.forecastRows,
    reviewRows: result.reviewRows,
    eligibilityStats: result.eligibilityStats,
    platformsGenerated: result.platformsGenerated,
  });
});

salesForecastRoutes.post(
  '/sales-forecasts/dify/single',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{
      skuCode?: string;
      station?: string;
      platform?: string;
      versionId?: string;
      monthCount?: number;
      assistMode?: 'auto' | 'human';
      exogenousFactors?: unknown;
    }>();

    const skuCode = body.skuCode?.trim();
    const station = body.station?.trim()?.toUpperCase();
    if (!skuCode || !station) {
      return c.json({ message: 'skuCode and station are required' }, 400);
    }

    if (!isSalesForecastWorkflowEnabled()) {
      return c.json(
        { message: 'AI 销量预测工作流未配置（DIFY_API_KEY_SALES_FORECAST）', difyEnabled: false },
        503,
      );
    }

    try {
      const exogenousFactors = normalizeForecastExogenousInput(body.exogenousFactors);
      const assistMode = body.assistMode === 'human' ? 'human' : 'auto';

      const result = await runDifySingleSkuForecast({
        skuCode,
        station,
        platform: body.platform,
        versionId: body.versionId,
        monthCount: body.monthCount,
        userId: user?.id,
        assistMode,
        exogenousFactors,
      });

      await writeAuditLog(c, {
        action: 'sales_forecast.dify_single',
        resourceType: 'sales_forecast_version',
        resourceId: result.versionId,
        detail: {
          skuCode: result.skuCode,
          writtenRows: result.writtenRows,
          assistMode,
          exogenousFactorCount: exogenousFactors?.factors.length ?? 0,
        },
        user,
      });

      return c.json(result);
    } catch (error) {
      const status = (error as Error & { status?: number }).status ?? 500;
      const message = error instanceof Error ? error.message : 'AI 辅助预测失败';
      return c.json({ message }, status);
    }
  },
);

salesForecastRoutes.get(
  '/sales-forecasts/generate-baseline/tasks/:taskRunId',
  requireMenu('data.forecast'),
  async (c) => {
    const taskRunId = c.req.param('taskRunId')?.trim();
    if (!taskRunId) {
      return c.json({ message: 'taskRunId is required' }, 400);
    }

    const run = await getTaskRunById(taskRunId);
    if (!run || run.taskName !== 'forecast_baseline') {
      return c.json({ message: 'Task run not found' }, 404);
    }

    const result = run.status === 'success' ? parseBaselineTaskResult(run.resultSummary) : null;
    return c.json({
      taskRunId: run.id,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      errorMessage: run.errorMessage,
      result,
    });
  },
);

salesForecastRoutes.get('/sales-forecasts/review-items', requireMenu('data.forecast'), async (c) => {
  const versionId = c.req.query('versionId')?.trim();
  const statusQuery = c.req.query('status')?.trim();
  const severityQuery = c.req.query('severity')?.trim();
  const groupBy = c.req.query('groupBy')?.trim() || 'sku_platform';
  if (statusQuery && !isOneOf(statusQuery, REVIEW_STATUSES)) {
    return c.json({ message: 'status must be one of pending, reviewed, ignored' }, 400);
  }
  if (severityQuery && !isOneOf(severityQuery, REVIEW_SEVERITIES)) {
    return c.json({ message: 'severity must be one of critical, warning, info' }, 400);
  }
  const status = isOneOf(statusQuery, REVIEW_STATUSES) ? statusQuery : undefined;
  const severity = isOneOf(severityQuery, REVIEW_SEVERITIES) ? severityQuery : undefined;
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );

  if (groupBy === 'sku_platform') {
    const grouped = await listGroupedReviewItems({
      versionId,
      status,
      severity,
      page,
      pageSize,
    });

    let versionSummary = null;
    let contexts: Awaited<ReturnType<typeof buildSkuForecastContextMap>> = {};
    let monthlyForecasts: Awaited<ReturnType<typeof buildSkuMonthlyForecastMap>> = {};

    const reviewIdentities = grouped.items.map((item) => ({
      skuId: item.skuId,
      station: item.station,
      platform: item.platform,
    }));

    if (versionId && grouped.items.length > 0) {
      [versionSummary, contexts, monthlyForecasts] = await Promise.all([
        getVersionForecastSummary(versionId),
        buildSkuForecastContextMap({
          versionId,
          identities: reviewIdentities,
        }),
        buildSkuMonthlyForecastMap({
          versionId,
          identities: reviewIdentities,
        }),
      ]);
    } else if (versionId) {
      versionSummary = await getVersionForecastSummary(versionId);
    }

    return c.json({
      groupBy: 'sku_platform',
      items: grouped.items,
      total: grouped.total,
      page,
      pageSize,
      versionSummary,
      contexts,
      monthlyForecasts,
    });
  }

  const conditions = [];
  if (versionId) conditions.push(eq(salesForecastReviewItems.versionId, versionId));
  if (status) conditions.push(eq(salesForecastReviewItems.status, status));
  if (severity) conditions.push(eq(salesForecastReviewItems.severity, severity));
  const where = conditions.length ? and(...conditions) : undefined;

  const base = db
    .select({
      id: salesForecastReviewItems.id,
      versionId: salesForecastReviewItems.versionId,
      skuId: salesForecastReviewItems.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      station: salesForecastReviewItems.station,
      platform: salesForecastReviewItems.platform,
      issueType: salesForecastReviewItems.issueType,
      severity: salesForecastReviewItems.severity,
      message: salesForecastReviewItems.message,
      suggestedDailyAvg: salesForecastReviewItems.suggestedDailyAvg,
      reviewedDailyAvg: salesForecastReviewItems.reviewedDailyAvg,
      status: salesForecastReviewItems.status,
      createdAt: salesForecastReviewItems.createdAt,
    })
    .from(salesForecastReviewItems)
    .innerJoin(skus, eq(skus.id, salesForecastReviewItems.skuId))
    .$dynamic();

  const [rows, countRow] = await Promise.all([
    base
      .where(where)
      .orderBy(desc(salesForecastReviewItems.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesForecastReviewItems)
      .where(where),
  ]);

  const items = rows.map(mapReviewItemRow);
  let versionSummary = null;
  let contexts: Awaited<ReturnType<typeof buildSkuForecastContextMap>> = {};
  let monthlyForecasts: Awaited<ReturnType<typeof buildSkuMonthlyForecastMap>> = {};

  const reviewIdentities = items.map((item) => ({
    skuId: item.skuId,
    station: item.station,
    platform: item.platform,
  }));

  if (versionId && items.length > 0) {
    [versionSummary, contexts, monthlyForecasts] = await Promise.all([
      getVersionForecastSummary(versionId),
      buildSkuForecastContextMap({
        versionId,
        identities: reviewIdentities,
      }),
      buildSkuMonthlyForecastMap({
        versionId,
        identities: reviewIdentities,
      }),
    ]);
  } else if (versionId) {
    versionSummary = await getVersionForecastSummary(versionId);
  }

  return c.json({
    groupBy: 'record',
    items,
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
    versionSummary,
    contexts,
    monthlyForecasts,
  });
});

salesForecastRoutes.get('/sales-forecasts/review-items/stats', requireMenu('data.forecast'), async (c) => {
  const versionId = c.req.query('versionId')?.trim() || undefined;
  const stats = await getReviewItemStats(versionId);
  return c.json(stats);
});

salesForecastRoutes.get('/sales-forecasts/version-summary', requireMenu('data.forecast'), async (c) => {
  const versionId = c.req.query('versionId')?.trim();
  if (!versionId) return c.json({ message: 'versionId is required' }, 400);
  const version = await getForecastVersionById(versionId);
  if (!version) return c.json({ message: 'Version not found' }, 404);
  const summary = await getVersionForecastSummary(versionId);
  return c.json(summary);
});

salesForecastRoutes.get('/sales-forecasts/sku-detail', requireMenu('data.forecast'), async (c) => {
  const versionId = c.req.query('versionId')?.trim();
  const skuId = c.req.query('skuId')?.trim();
  const skuCode = c.req.query('skuCode')?.trim();
  const station = c.req.query('station')?.trim();
  const platform = c.req.query('platform')?.trim();
  if (!versionId || !station || !platform) {
    return c.json({ message: 'versionId, station and platform are required' }, 400);
  }
  if (!skuId && !skuCode) {
    return c.json({ message: 'skuId or skuCode is required' }, 400);
  }

  const [skuRow] = skuId
    ? await db
        .select({
          id: skus.id,
          code: skus.code,
          name: skus.name,
          category: skus.category,
          productCategory: skus.productCategory,
          lifecycle: skus.lifecycle,
          salesCountry: skus.salesCountry,
          ownerName: skus.ownerName,
          developerName: skus.developerName,
          merchantCode: skus.merchantCode,
          merchantName: skus.merchantName,
          specAttrs: skus.specAttrs,
          unit: skus.unit,
          leadTimeDays: skus.leadTimeDays,
          moq: skus.moq,
        })
        .from(skus)
        .where(eq(skus.id, skuId))
        .limit(1)
    : await db
        .select({
          id: skus.id,
          code: skus.code,
          name: skus.name,
          category: skus.category,
          productCategory: skus.productCategory,
          lifecycle: skus.lifecycle,
          salesCountry: skus.salesCountry,
          ownerName: skus.ownerName,
          developerName: skus.developerName,
          merchantCode: skus.merchantCode,
          merchantName: skus.merchantName,
          specAttrs: skus.specAttrs,
          unit: skus.unit,
          leadTimeDays: skus.leadTimeDays,
          moq: skus.moq,
        })
        .from(skus)
        .where(eq(skus.code, skuCode!.toUpperCase()))
        .limit(1);

  if (!skuRow) {
    return c.json({ message: 'SKU not found' }, 404);
  }

  const resolvedSkuId = skuRow.id;
  const identity = { skuId: resolvedSkuId, station, platform };
  const contextKey = `${resolvedSkuId}::${station}::${platform}`;

  const [versionSummary, contexts, reviewRows] = await Promise.all([
    getVersionForecastSummary(versionId),
    buildSkuForecastContextMap({ versionId, identities: [identity] }),
    db
      .select({
        id: salesForecastReviewItems.id,
        versionId: salesForecastReviewItems.versionId,
        skuId: salesForecastReviewItems.skuId,
        skuCode: skus.code,
        skuName: skus.name,
        station: salesForecastReviewItems.station,
        platform: salesForecastReviewItems.platform,
        issueType: salesForecastReviewItems.issueType,
        severity: salesForecastReviewItems.severity,
        message: salesForecastReviewItems.message,
        suggestedDailyAvg: salesForecastReviewItems.suggestedDailyAvg,
        reviewedDailyAvg: salesForecastReviewItems.reviewedDailyAvg,
        status: salesForecastReviewItems.status,
        createdAt: salesForecastReviewItems.createdAt,
      })
      .from(salesForecastReviewItems)
      .innerJoin(skus, eq(skus.id, salesForecastReviewItems.skuId))
      .where(
        and(
          eq(salesForecastReviewItems.versionId, versionId),
          eq(salesForecastReviewItems.skuId, resolvedSkuId),
          eq(salesForecastReviewItems.station, station),
          eq(salesForecastReviewItems.platform, platform),
        ),
      )
      .orderBy(desc(salesForecastReviewItems.createdAt)),
  ]);

  return c.json({
    versionSummary,
    context: contexts[contextKey] ?? null,
    reviewItems: reviewRows.map(mapReviewItemRow),
    sku: {
      id: skuRow.id,
      code: skuRow.code,
      name: skuRow.name,
      category: skuRow.category,
      productCategory: skuRow.productCategory,
      lifecycle: skuRow.lifecycle,
      salesCountry: skuRow.salesCountry,
      ownerName: skuRow.ownerName,
      developerName: skuRow.developerName,
      merchantCode: skuRow.merchantCode,
      merchantName: skuRow.merchantName,
      specAttrs: skuRow.specAttrs,
      unit: skuRow.unit,
      leadTimeDays: skuRow.leadTimeDays,
      moq: skuRow.moq,
    },
  });
});

salesForecastRoutes.post(
  '/sales-forecasts/review-items/batch-status',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const body = await c.req.json<{
      ids?: string[];
      status?: 'pending' | 'reviewed' | 'ignored';
    }>();
    const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string' && id.trim()) : [];
    if (ids.length === 0) return c.json({ message: 'ids is required' }, 400);
    if (!body.status || !isOneOf(body.status, REVIEW_STATUSES)) {
      return c.json({ message: 'status must be one of pending, reviewed, ignored' }, 400);
    }
    const updated = await updateReviewItemsStatus(ids, body.status);
    return c.json({ updated });
  },
);

salesForecastRoutes.post(
  '/sales-forecasts/review-items/clear',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{
      versionId?: string;
      scope?: 'all' | 'version' | 'completed';
      confirmAll?: boolean;
    }>();
    const scope = body.scope ?? 'completed';
    if (!isOneOf(scope, ['all', 'version', 'completed'] as const)) {
      return c.json({ message: 'scope must be one of all, version, completed' }, 400);
    }
    if (scope === 'all' && !body.confirmAll) {
      return c.json({ message: 'Clearing all review items requires confirmAll: true' }, 400);
    }

    try {
      const result = await clearReviewItems({ versionId: body.versionId, scope });
      await writeAuditLog(c, {
        action: 'sales_forecast.clear_review_items',
        resourceType: 'sales_forecast_review_items',
        resourceId: body.versionId,
        detail: { scope, deleted: result.deleted },
        user,
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Clear review items failed';
      return c.json({ message }, 400);
    }
  },
);

salesForecastRoutes.post(
  '/sales-forecasts/review-items/batch',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{
      versionId?: string;
      action?: 'accept_suggested' | 'ignore_info' | 'ignore_all_pending';
    }>();
    const versionId = body.versionId?.trim();
    const action = body.action;
    if (!versionId) return c.json({ message: 'versionId is required' }, 400);
    if (!action || !isOneOf(action, ['accept_suggested', 'ignore_info', 'ignore_all_pending'] as const)) {
      return c.json(
        { message: 'action must be one of accept_suggested, ignore_info, ignore_all_pending' },
        400,
      );
    }

    try {
      const result = await batchProcessReviewItems({
        versionId,
        action,
        reviewerId: user.id,
      });
      await writeAuditLog(c, {
        action: 'sales_forecast.batch_review_items',
        resourceType: 'sales_forecast_version',
        resourceId: versionId,
        detail: { action, ...result },
        user,
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Batch review failed';
      return c.json({ message }, 400);
    }
  },
);

salesForecastRoutes.patch('/sales-forecasts/review-items/:id', requireMenu('data.forecast'), requireForecastWrite, async (c) => {
  const user = await getCurrentUser(c);
  const reviewItemId = c.req.param('id');
  if (!reviewItemId) return c.json({ message: 'Review item id required' }, 400);
  const body = await c.req.json<{
    status?: 'pending' | 'reviewed' | 'ignored';
    reviewedDailyAvg?: number;
  }>();
  const requestedStatus = body.status?.trim();
  let nextStatus: (typeof REVIEW_STATUSES)[number] = 'reviewed';
  if (requestedStatus) {
    if (!isOneOf(requestedStatus, REVIEW_STATUSES)) {
      return c.json({ message: 'Invalid review status' }, 400);
    }
    nextStatus = requestedStatus;
  }

  if (body.reviewedDailyAvg != null) {
    return c.json(
      { message: 'reviewedDailyAvg is deprecated; review only marks acknowledgment without changing forecast' },
      400,
    );
  }

  const [existingReview] = await db
    .select()
    .from(salesForecastReviewItems)
    .where(eq(salesForecastReviewItems.id, reviewItemId))
    .limit(1);

  if (!existingReview) return c.json({ message: 'Review item not found' }, 404);

  if (nextStatus === 'reviewed') {
    const version = await getForecastVersionById(existingReview.versionId);
    if (!version) return c.json({ message: 'Forecast version not found' }, 404);
    if (version.status !== 'draft') {
      return c.json({ message: 'Only draft version accepts review updates' }, 400);
    }
  }

  const [updated] = await db
    .update(salesForecastReviewItems)
    .set({
      status: nextStatus,
      reviewerId: user.id,
      reviewedAt: new Date(),
    })
    .where(eq(salesForecastReviewItems.id, reviewItemId))
    .returning();

  if (!updated) return c.json({ message: 'Review item not found' }, 404);

  const [row] = await db
    .select({
      id: salesForecastReviewItems.id,
      versionId: salesForecastReviewItems.versionId,
      skuId: salesForecastReviewItems.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      station: salesForecastReviewItems.station,
      platform: salesForecastReviewItems.platform,
      issueType: salesForecastReviewItems.issueType,
      severity: salesForecastReviewItems.severity,
      message: salesForecastReviewItems.message,
      suggestedDailyAvg: salesForecastReviewItems.suggestedDailyAvg,
      reviewedDailyAvg: salesForecastReviewItems.reviewedDailyAvg,
      status: salesForecastReviewItems.status,
      createdAt: salesForecastReviewItems.createdAt,
    })
    .from(salesForecastReviewItems)
    .innerJoin(skus, eq(skus.id, salesForecastReviewItems.skuId))
    .where(eq(salesForecastReviewItems.id, updated.id))
    .limit(1);

  if (!row) return c.json({ message: 'Review item not found' }, 404);
  return c.json(mapReviewItemRow(row));
});

salesForecastRoutes.get('/sales-forecasts/trends', requireMenu('data.forecast'), async (c) => {
  const dimensionQuery = c.req.query('dimensionType')?.trim();
  if (dimensionQuery && !isOneOf(dimensionQuery, SEASONALITY_DIMENSION_TYPES)) {
    return c.json({ message: 'dimensionType must be one of category, project_group' }, 400);
  }
  const dimensionType = isOneOf(dimensionQuery, SEASONALITY_DIMENSION_TYPES)
    ? dimensionQuery
    : undefined;
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );

  const conditions = [];
  if (dimensionType) conditions.push(eq(salesForecastSeasonality.dimensionType, dimensionType));
  const where = conditions.length ? and(...conditions) : undefined;

  const base = db.select().from(salesForecastSeasonality).$dynamic();
  const [rows, countRow] = await Promise.all([
    base
      .where(where)
      .orderBy(salesForecastSeasonality.dimensionValue, salesForecastSeasonality.month)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesForecastSeasonality)
      .where(where),
  ]);

  return c.json({
    items: rows.map((row) => ({
      ...row,
      seasonalityFactor: numericOrNull(row.seasonalityFactor) ?? 0,
      trendFactor: numericOrNull(row.trendFactor),
    })),
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
});

salesForecastRoutes.get('/sales-forecasts/trends/horizon', requireMenu('data.forecast'), async (c) => {
  const dimensionQuery = c.req.query('dimensionType')?.trim();
  if (dimensionQuery && !isOneOf(dimensionQuery, SEASONALITY_DIMENSION_TYPES)) {
    return c.json({ message: 'dimensionType must be one of category, project_group' }, 400);
  }
  const dimensionType = isOneOf(dimensionQuery, SEASONALITY_DIMENSION_TYPES)
    ? dimensionQuery
    : undefined;
  const search = c.req.query('search')?.trim() || undefined;
  const monthCountRaw = Number(c.req.query('monthCount')?.trim());
  const monthCount = Number.isFinite(monthCountRaw) ? monthCountRaw : undefined;
  const historyMonthCountRaw = Number(c.req.query('historyMonthCount')?.trim());
  const historyMonthCount = Number.isFinite(historyMonthCountRaw) ? historyMonthCountRaw : undefined;
  const { page, pageSize } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );

  const result = await listSeasonalityHorizon({
    dimensionType,
    search,
    page,
    pageSize,
    monthCount,
    historyMonthCount,
  });
  return c.json(result);
});

salesForecastRoutes.get('/sales-forecasts/horizon', requireMenu('data.forecast'), async (c) => {
  const versionId = c.req.query('versionId')?.trim() || undefined;
  const station = c.req.query('station')?.trim() || undefined;
  const platform = c.req.query('platform')?.trim() || undefined;
  const skuCode = c.req.query('skuCode')?.trim() || undefined;
  const skuId = c.req.query('skuId')?.trim() || undefined;
  const category = c.req.query('category')?.trim() || undefined;
  const profileSegment = c.req.query('profileSegment')?.trim() || undefined;
  const pendingCalibration = c.req.query('pendingCalibration')?.trim() === 'true';
  const monthCountRaw = Number(c.req.query('monthCount')?.trim());
  const monthCount = Number.isFinite(monthCountRaw) ? monthCountRaw : undefined;
  const historyMonthCountRaw = Number(c.req.query('historyMonthCount')?.trim());
  const historyMonthCount = Number.isFinite(historyMonthCountRaw) ? historyMonthCountRaw : undefined;
  const { page, pageSize } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );

  const result = await listForecastHorizon({
    versionId,
    station,
    platform,
    skuId,
    skuCode,
    category,
    profileSegment,
    pendingCalibration: pendingCalibration || undefined,
    page,
    pageSize,
    monthCount,
    historyMonthCount,
  });
  return c.json(result);
});

salesForecastRoutes.post(
  '/sales-forecasts/trends/rebuild',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    try {
      const result = await rebuildSeasonalityFromSalesHistoryMonthly({ createdBy: user.id });
      await writeAuditLog(c, {
        action: 'sales_forecast.rebuild_seasonality',
        resourceType: 'sales_forecast_seasonality',
        detail: result,
        user,
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Seasonality rebuild failed';
      return c.json({ message }, 400);
    }
  },
);

salesForecastRoutes.post(
  '/sales-forecasts/reset-all',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{ confirmAll?: boolean }>().catch(() => ({}));
    if (!body.confirmAll) {
      return c.json({ message: 'Clearing all forecast data requires confirmAll: true' }, 400);
    }

    try {
      const result = await clearAllForecastData();
      await writeAuditLog(c, {
        action: 'sales_forecast.reset_all',
        resourceType: 'sales_forecast',
        detail: result,
        user,
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : '清空预测数据失败';
      return c.json({ message }, 500);
    }
  },
);

salesForecastRoutes.get('/sales-forecast-versions', requireMenu('data.forecast'), async (c) => {
  const statusQuery = c.req.query('status')?.trim();
  if (statusQuery && !isOneOf(statusQuery, FORECAST_VERSION_STATUSES)) {
    return c.json({ message: 'status must be one of draft, published, archived' }, 400);
  }
  const status = statusQuery;
  const includeStats = c.req.query('includeStats')?.trim() === '1';
  if (includeStats) {
    const rows = await listForecastVersionsWithStats(status);
    return c.json(rows);
  }
  const rows = await listForecastVersions(status);
  return c.json(rows);
});

salesForecastRoutes.get('/sales-forecast-versions/:id', requireMenu('data.forecast'), async (c) => {
  const row = await getForecastVersionWithStats(c.req.param('id'));
  if (!row) return c.json({ message: 'Version not found' }, 404);
  return c.json(row);
});

salesForecastRoutes.post('/sales-forecast-versions', requireMenu('data.forecast'), requireForecastWrite, async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{ versionName?: string; station?: string }>();

  const row = await getOrCreateDraftVersion({
    versionName: body.versionName?.trim() || undefined,
    station: body.station?.trim() ? body.station.trim().toUpperCase() : undefined,
    createdBy: user.id,
  });

  await writeAuditLog(c, {
    action: 'forecast_version.create',
    resourceType: 'sales_forecast_version',
    resourceId: row.id,
    user,
  });

  return c.json(row, 201);
});

salesForecastRoutes.get('/sales-forecast-versions/:id/validate', requireMenu('data.forecast'), async (c) => {
  const versionId = c.req.param('id');
  const rows = await loadVersionRows(versionId);
  const issues = validateForecastRows(rows);
  return c.json({ issues, canPublish: !hasBlockingForecastIssues(issues), rowCount: rows.length });
});

salesForecastRoutes.post(
  '/sales-forecast-versions/:id/publish',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const versionId = c.req.param('id');
    const rows = await loadVersionRows(versionId);
    const issues = validateForecastRows(rows);
    if (hasBlockingForecastIssues(issues)) {
      return c.json({ message: 'Validation failed', issues }, 400);
    }

    const published = await publishForecastVersion(versionId, user.id);
    await writeAuditLog(c, {
      action: 'forecast_version.publish',
      resourceType: 'sales_forecast_version',
      resourceId: versionId,
      detail: { warningCount: issues.filter((i) => i.level === 'warning').length },
      user,
    });
    return c.json({ version: published, issues });
  },
);

salesForecastRoutes.post(
  '/sales-forecast-versions/:id/archive',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const row = await archiveForecastVersion(c.req.param('id'));
    if (!row) return c.json({ message: 'Version not found' }, 404);
    await writeAuditLog(c, {
      action: 'forecast_version.archive',
      resourceType: 'sales_forecast_version',
      resourceId: row.id,
      user,
    });
    return c.json(row);
  },
);

salesForecastRoutes.get('/sales-forecast-versions/:id/impact-preview', requireMenu('data.forecast'), async (c) => {
  const versionId = c.req.param('id');
  try {
    const preview = await buildForecastImpactPreview(versionId);
    const publishedId = await getPrimaryPublishedVersionId(preview.station ?? undefined);
    if (publishedId && publishedId !== versionId) {
      const delta = await compareForecastDemandChange({
        versionId,
        baselineVersionId: publishedId,
        station: preview.station ?? undefined,
      });
      preview.summary += `\n相较当前发布版本，${delta.changedSkuCount} 个 SKU 预测日均变化超过 5%。`;
    }
    return c.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Impact preview failed';
    return c.json({ message }, 400);
  }
});

salesForecastRoutes.get('/sales-forecast-versions/:id/review-summary', requireMenu('data.forecast'), async (c) => {
  const versionId = c.req.param('id');
  const rows = await loadVersionRows(versionId);
  const issues = validateForecastRows(rows);
  const version = await getForecastVersionById(versionId);
  const summary = buildForecastReviewSummary({
    versionName: version?.versionName ?? versionId,
    versionStatus: version?.status ?? 'unknown',
    issues,
    rowCount: rows.length,
  });
  return c.json({ summary, issues });
});

salesForecastRoutes.post(
  '/sales-forecasts/monthly-sales/aggregate',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{ lookbackMonths?: number }>().catch(() => ({}));
    const lookbackMonths = body.lookbackMonths ?? 36;
    if (!Number.isInteger(lookbackMonths) || lookbackMonths < 1 || lookbackMonths > 36) {
      return c.json({ message: 'lookbackMonths must be an integer between 1 and 36' }, 400);
    }

    const aggregate = await aggregateSalesHistoryMonthlyFromDaily({ lookbackMonths });
    const coverage = await getMonthlySalesCoverageStats();

    await writeAuditLog(c, {
      action: 'sales_forecast.aggregate_monthly_sales',
      resourceType: 'sales_history_monthly',
      detail: { ...aggregate, coverage },
      user,
    });

    return c.json({ aggregate, coverage });
  },
);

salesForecastRoutes.post(
  '/sales-forecasts/accuracy/backtest',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{
      monthCount?: number;
      versionId?: string;
      createReviewItems?: boolean;
    }>();

    const monthCount = body.monthCount ?? 6;
    if (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > 24) {
      return c.json({ message: 'monthCount must be an integer between 1 and 24' }, 400);
    }

    const result = await computeForecastAccuracyBacktest({
      monthCount,
      versionId: body.versionId,
      createReviewItems: body.createReviewItems ?? true,
    });

    await writeAuditLog(c, {
      action: 'sales_forecast.accuracy_backtest',
      resourceType: 'forecast_accuracy_monthly',
      resourceId: body.versionId,
      detail: {
        monthCount: result.monthCount,
        totalUpserted: result.totalUpserted,
        totalHighMapeCount: result.totalHighMapeCount,
      },
      user,
    });

    return c.json(result);
  },
);

salesForecastRoutes.post(
  '/sales-forecasts/accuracy/walkforward',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{
      asOf?: string;
      monthCount?: number;
      station?: string;
      platform?: string;
      skuCode?: string;
      versionName?: string;
      createReviewItems?: boolean;
      exportCsvPath?: string;
      tierFilter?: 'core' | 'mid' | 'tail' | 'all';
      replaceVersion?: boolean;
    }>();

    const asOf = body.asOf?.trim() || computeWalkForwardAsOf(body.monthCount ?? 6);
    const monthCount = body.monthCount ?? 6;
    if (!Number.isInteger(monthCount) || monthCount < 1 || monthCount > 24) {
      return c.json({ message: 'monthCount must be an integer between 1 and 24' }, 400);
    }

    try {
      const result = await runWalkForwardAccuracyBacktest({
        asOf,
        monthCount,
        station: body.station,
        platform: body.platform,
        skuCode: body.skuCode,
        versionName: body.versionName,
        createReviewItems: body.createReviewItems ?? false,
        exportCsvPath: body.exportCsvPath,
        tierFilter: body.tierFilter,
        replaceVersion: body.replaceVersion,
        createdBy: user.id,
      });

      await writeAuditLog(c, {
        action: 'sales_forecast.walkforward_backtest',
        resourceType: 'forecast_accuracy_monthly',
        resourceId: result.version.id,
        detail: {
          asOf: result.asOf,
          monthCount: result.monthCount,
          totalUpserted: result.totalUpserted,
          csvPath: result.csvPath,
        },
        user,
      });

      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Walk-forward backtest failed';
      return c.json({ message }, 400);
    }
  },
);

salesForecastRoutes.get('/sales-forecasts/accuracy/diagnostics', requireMenu('data.forecast'), async (c) => {
  const parsedLimit = parseOptionalIntegerQuery(c.req.query('limitTopErrors')?.trim(), 'limitTopErrors', {
    min: 1,
    max: 200,
  });
  if (parsedLimit.error) return c.json({ message: parsedLimit.error }, 400);

  try {
    const diagnostics = await buildForecastAccuracyDiagnostics({
      versionId: c.req.query('versionId')?.trim(),
      versionName: c.req.query('versionName')?.trim(),
      station: c.req.query('station')?.trim(),
      platform: c.req.query('platform')?.trim(),
      startMonth: c.req.query('startMonth')?.trim(),
      endMonth: c.req.query('endMonth')?.trim(),
      asOf: c.req.query('asOf')?.trim(),
      limitTopErrors: parsedLimit.value,
    });
    return c.json(diagnostics);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Forecast accuracy diagnostics failed';
    return c.json({ message }, 400);
  }
});
salesForecastRoutes.post(
  '/sales-forecasts/accuracy/review-queue',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{
      sourceVersionId?: string;
      sourceVersionName?: string;
      targetVersionId?: string;
      station?: string;
      platform?: string;
      startMonth?: string;
      endMonth?: string;
      limit?: number;
      minWmape?: number;
    }>();

    const targetVersionId = body.targetVersionId?.trim();
    if (!targetVersionId) return c.json({ message: 'targetVersionId is required' }, 400);

    try {
      const result = await createForecastAccuracyReviewQueue({
        sourceVersionId: body.sourceVersionId?.trim(),
        sourceVersionName: body.sourceVersionName?.trim(),
        targetVersionId,
        station: body.station?.trim(),
        platform: body.platform?.trim(),
        startMonth: body.startMonth?.trim(),
        endMonth: body.endMonth?.trim(),
        limit: body.limit,
        minWmape: body.minWmape,
      });

      await writeAuditLog(c, {
        action: 'sales_forecast.accuracy_review_queue',
        resourceType: 'sales_forecast_review_items',
        resourceId: targetVersionId,
        detail: {
          sourceVersionId: result.sourceVersion.id,
          targetVersionId,
          candidates: result.candidates,
          upserted: result.upserted,
          skippedCompleted: result.skippedCompleted,
        },
        user,
      });

      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Forecast accuracy review queue failed';
      return c.json({ message }, 400);
    }
  },
);
salesForecastRoutes.get('/sales-forecasts/accuracy/summary', requireMenu('data.forecast'), async (c) => {
  const parsedYear = parseOptionalIntegerQuery(c.req.query('year')?.trim(), 'year');
  if (parsedYear.error) return c.json({ message: parsedYear.error }, 400);
  const parsedMonth = parseOptionalIntegerQuery(c.req.query('month')?.trim(), 'month', {
    min: 1,
    max: 12,
  });
  if (parsedMonth.error) return c.json({ message: parsedMonth.error }, 400);

  const summary = await summarizeForecastAccuracy({
    versionId: c.req.query('versionId')?.trim(),
    year: parsedYear.value,
    month: parsedMonth.value,
    station: c.req.query('station')?.trim(),
    platform: c.req.query('platform')?.trim(),
  });
  return c.json(summary);
});

salesForecastRoutes.get('/sales-forecasts/accuracy', requireMenu('data.forecast'), async (c) => {
  const parsedYear = parseOptionalIntegerQuery(c.req.query('year')?.trim(), 'year');
  if (parsedYear.error) return c.json({ message: parsedYear.error }, 400);
  const parsedMonth = parseOptionalIntegerQuery(c.req.query('month')?.trim(), 'month', {
    min: 1,
    max: 12,
  });
  if (parsedMonth.error) return c.json({ message: parsedMonth.error }, 400);
  const year = parsedYear.value;
  const month = parsedMonth.value;
  const station = c.req.query('station')?.trim();
  const platform = c.req.query('platform')?.trim();
  const versionId = c.req.query('versionId')?.trim();
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );

  const result = await listForecastAccuracy({ year, month, station, platform, versionId, page, pageSize });
  const summary = buildForecastAccuracyDigest(result.items, result.total);
  return c.json({
    items: result.items,
    summary,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
});

salesForecastRoutes.get('/sales-forecasts/accuracy/export', requireMenu('data.forecast'), async (c) => {
  const parsedYear = parseOptionalIntegerQuery(c.req.query('year')?.trim(), 'year');
  if (parsedYear.error) return c.json({ message: parsedYear.error }, 400);
  const parsedMonth = parseOptionalIntegerQuery(c.req.query('month')?.trim(), 'month', {
    min: 1,
    max: 12,
  });
  if (parsedMonth.error) return c.json({ message: parsedMonth.error }, 400);

  const versionId = c.req.query('versionId')?.trim();
  if (!versionId) {
    return c.json({ message: 'versionId is required' }, 400);
  }

  const version = await getForecastVersionById(versionId);
  if (!version) {
    return c.json({ message: 'Forecast version not found' }, 404);
  }

  const groupBy = c.req.query('groupBy')?.trim().toLowerCase();
  const exportParams = {
    versionId,
    year: parsedYear.value,
    month: parsedMonth.value,
    station: c.req.query('station')?.trim(),
    platform: c.req.query('platform')?.trim(),
  };

  const { csv, rowCount } =
    groupBy === 'sku'
      ? await buildForecastAccuracySkuExportCsv(exportParams)
      : await buildForecastAccuracyExportCsv(exportParams);

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = version.versionNo.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 48);
  const suffix = groupBy === 'sku' ? 'sku-summary' : 'detail';
  return csvAttachment(`forecast-accuracy-${suffix}-${safeName}-${stamp}.csv`, csv);
});

salesForecastRoutes.get('/sales-forecasts', requireMenu('data.forecast'), async (c) => {
  const skuCode = c.req.query('skuCode')?.trim();
  const station = c.req.query('station')?.trim();
  const platform = c.req.query('platform')?.trim();
  const parsedYear = parseOptionalIntegerQuery(c.req.query('year')?.trim(), 'year');
  if (parsedYear.error) return c.json({ message: parsedYear.error }, 400);
  const year = parsedYear.value;
  const versionId = c.req.query('versionId')?.trim();
  const forecastMonth = c.req.query('forecastMonth')?.trim();
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );

  const conditions = [];
  if (skuCode) conditions.push(eq(skus.code, skuCode));
  if (station) conditions.push(eq(salesForecastMonthly.station, station));
  if (platform) {
    const code = await resolveSalesPlatformCode(platform);
    if (code) conditions.push(eq(salesForecastMonthly.platform, code));
  }
  if (year) conditions.push(eq(salesForecastMonthly.forecastYear, year));
  if (versionId) {
    conditions.push(eq(salesForecastMonthly.versionId, versionId));
  } else {
    const publishedId = await getPrimaryPublishedVersionId(station);
    conditions.push(eq(salesForecastMonthly.versionId, publishedId));
  }
  if (forecastMonth) {
    const parsed = forecastMonth.match(/^(\d{4})-(\d{1,2})$/);
    if (!parsed) {
      return c.json({ message: 'forecastMonth must use YYYY-MM format' }, 400);
    }
    const forecastYear = Number(parsed[1]);
    const month = Number(parsed[2]);
    if (!Number.isInteger(forecastYear) || !Number.isInteger(month) || month < 1 || month > 12) {
      return c.json({ message: 'forecastMonth month must be between 1 and 12' }, 400);
    }
    conditions.push(eq(salesForecastMonthly.forecastYear, forecastYear));
    conditions.push(eq(salesForecastMonthly.month, month));
  }

  const base = db
    .select({
      id: salesForecastMonthly.id,
      skuId: salesForecastMonthly.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      station: salesForecastMonthly.station,
      platform: salesForecastMonthly.platform,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      baselineDailyAvg: salesForecastMonthly.baselineDailyAvg,
      manualDailyAvg: salesForecastMonthly.manualDailyAvg,
      adjustReason: salesForecastMonthly.adjustReason,
      confidenceLevel: salesForecastMonthly.confidenceLevel,
      lifecycle: salesForecastMonthly.lifecycle,
      ownerName: salesForecastMonthly.ownerName,
      source: salesForecastMonthly.source,
      versionId: salesForecastMonthly.versionId,
      updatedAt: salesForecastMonthly.updatedAt,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .$dynamic();

  const where = and(...conditions);
  const [rows, countRow] = await Promise.all([
    base
      .where(where)
      .orderBy(skus.code, salesForecastMonthly.forecastYear, salesForecastMonthly.month)
      .limit(pageSize)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(salesForecastMonthly)
      .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
      .where(where),
  ]);

  return c.json({
    items: rows.map(mapForecastRow),
    total: countRow[0]?.count ?? 0,
    page,
    pageSize,
  });
});

salesForecastRoutes.put('/sales-forecasts/:id', requireMenu('data.forecast'), requireForecastWrite, async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    forecastDailyAvg?: number;
    lifecycle?: string;
    ownerName?: string;
    platform?: string;
    adjustReason?: string | null;
    confidenceLevel?: 'high' | 'medium' | 'low';
    baselineDailyAvg?: number;
    manualDailyAvg?: number | null;
    clearManual?: boolean;
  }>();

  const forecastDailyAvg = parseOptionalPositiveNumber(body.forecastDailyAvg, 'forecastDailyAvg');
  if (forecastDailyAvg.error) return c.json({ message: forecastDailyAvg.error }, 400);
  const baselineDailyAvg = parseOptionalPositiveNumber(body.baselineDailyAvg, 'baselineDailyAvg');
  if (baselineDailyAvg.error) return c.json({ message: baselineDailyAvg.error }, 400);

  let manualPatch: string | null | undefined;
  if (body.clearManual === true || body.manualDailyAvg === null) {
    manualPatch = null;
  } else if (body.manualDailyAvg !== undefined) {
    const manualDailyAvg = parseOptionalPositiveNumber(body.manualDailyAvg, 'manualDailyAvg');
    if (manualDailyAvg.error) return c.json({ message: manualDailyAvg.error }, 400);
    if (manualDailyAvg.value === undefined) {
      return c.json({ message: 'manualDailyAvg must be a finite number' }, 400);
    }
    manualPatch = String(manualDailyAvg.value);
  }

  if (body.confidenceLevel !== undefined && !isOneOf(body.confidenceLevel, CONFIDENCE_LEVELS)) {
    return c.json({ message: 'confidenceLevel must be one of high, medium, low' }, 400);
  }

  const [existing] = await db
    .select()
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.id, c.req.param('id')))
    .limit(1);

  if (!existing) return c.json({ message: 'Forecast row not found' }, 404);
  if (existing.versionId) await assertVersionIsDraft(existing.versionId);

  const platformCode = body.platform != null ? await resolveSalesPlatformCode(body.platform) : existing.platform;
  if (body.platform != null && !platformCode) {
    return c.json({ message: `Unknown platform: ${body.platform}` }, 400);
  }

  const patch: Record<string, unknown> = {
    lifecycle: body.lifecycle ?? existing.lifecycle,
    ownerName: body.ownerName ?? existing.ownerName,
    platform: platformCode ?? existing.platform,
    confidenceLevel: body.confidenceLevel ?? existing.confidenceLevel,
    updatedAt: new Date(),
  };

  if (forecastDailyAvg.value !== undefined) {
    patch.forecastDailyAvg = String(forecastDailyAvg.value);
  }
  if (baselineDailyAvg.value !== undefined) {
    patch.baselineDailyAvg = String(baselineDailyAvg.value);
  }
  if (manualPatch !== undefined) {
    patch.manualDailyAvg = manualPatch;
  }
  if (body.adjustReason !== undefined) {
    patch.adjustReason = body.adjustReason;
  }

  const [row] = await db
    .update(salesForecastMonthly)
    .set(patch)
    .where(eq(salesForecastMonthly.id, existing.id))
    .returning();

  await writeAuditLog(c, {
    action: 'sales_forecast.update',
    resourceType: 'sales_forecast_monthly',
    resourceId: existing.id,
    detail: { before: existing, after: row },
    user,
  });

  const [sku] = await db
    .select({ code: skus.code, name: skus.name })
    .from(skus)
    .where(eq(skus.id, row.skuId))
    .limit(1);

  return c.json(
    mapForecastRow({
      ...row,
      skuCode: sku?.code ?? '',
      skuName: sku?.name ?? '',
    }),
  );
});

salesForecastRoutes.get('/sales-forecasts/promo-calendar', requireMenu('data.forecast'), async (c) => {
  const station = c.req.query('station')?.trim();
  const platform = c.req.query('platform')?.trim();
  const conditions = [];
  if (station) conditions.push(eq(forecastPromoCalendar.station, station));
  if (platform) conditions.push(eq(forecastPromoCalendar.platform, platform));
  const where = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select()
    .from(forecastPromoCalendar)
    .where(where)
    .orderBy(forecastPromoCalendar.promoYear, forecastPromoCalendar.promoMonth);
  return c.json({
    items: rows.map((r) => ({
      ...r,
      intensity: Number(r.intensity),
    })),
  });
});

salesForecastRoutes.post(
  '/sales-forecasts/promo-calendar',
  requireMenu('data.forecast'),
  requireForecastWrite,
  async (c) => {
    const user = await getCurrentUser(c);
    const body = await c.req.json<{
      station: string;
      platform?: string;
      promoYear: number;
      promoMonth: number;
      intensity?: number;
      label?: string;
    }>();
    if (!body.station?.trim()) return c.json({ message: 'station is required' }, 400);
    if (!Number.isInteger(body.promoYear) || !Number.isInteger(body.promoMonth)) {
      return c.json({ message: 'promoYear and promoMonth are required' }, 400);
    }
    const platform = body.platform?.trim() || 'ALL';
    const intensity = body.intensity ?? 1;
    const [row] = await db
      .insert(forecastPromoCalendar)
      .values({
        station: body.station.trim().toUpperCase(),
        platform,
        promoYear: body.promoYear,
        promoMonth: body.promoMonth,
        intensity: String(intensity),
        label: body.label?.trim() || null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [
          forecastPromoCalendar.station,
          forecastPromoCalendar.platform,
          forecastPromoCalendar.promoYear,
          forecastPromoCalendar.promoMonth,
        ],
        set: {
          intensity: String(intensity),
          label: body.label?.trim() || null,
          updatedAt: new Date(),
        },
      })
      .returning();
    await writeAuditLog(c, {
      action: 'sales_forecast.promo_calendar_upsert',
      resourceType: 'forecast_promo_calendar',
      resourceId: row.id,
      user,
    });
    return c.json({ item: { ...row, intensity: Number(row.intensity) } });
  },
);


