import { and, inArray, lt } from 'drizzle-orm';
import {
  db,
  layeredForecastNodes,
  layeredForecastVersions,
  salesHistory,
  skus,
} from '@scm/db';
import {
  LAYERED_PLATFORM_ALL,
  buildHorizonPeriods,
  categoryLeaf,
  normalizeProjectGroup,
} from './layered-forecast-dims.js';
import { computeSkuDraftQty } from './layered-forecast-draft.js';
import { FORECAST_V41_PLATFORM_CODES } from './forecast-platform-scope.js';
import { normalizeSalesPlatform } from './forecast-demand.js';
import { parseAndValidateForecastStartMonth } from './forecast-start-month.js';
import { reconcileUnlocked } from './layered-forecast-reconcile.js';
import { extrapolateTrendSeasonal, scaleChildrenToParent } from './layered-forecast-series.js';
import { skuMatchesCategoryFilter } from './sku-category.js';

export type AggregateHistory = {
  /** `${skuId}\t${platform}\t${period}` -> monthly qty */
  monthlyBySkuPlatform: Map<string, number>;
  /** `${skuId}\t${platform}` -> qty in the 90 days before the start month */
  recent90BySkuPlatform: Map<string, number>;
};

export type LayeredNodeDraft = {
  level: 'project_group' | 'category' | 'platform' | 'sku';
  projectGroup: string;
  /** Group rows use ALL; category leaves are used at all lower levels. */
  category: string;
  platform: string;
  skuId: string | null;
  period: string;
  qty: number;
  systemQty: number;
  draftQty: number | null;
  locked: boolean;
  seasonalityFactor: number | null;
  trendFactor: number | null;
  peakMonth: number | null;
  manualEdited: boolean;
};

type SkuInput = { id: string; projectGroup: string | null; category: string | null };
type DimensionForecast = {
  qty: number[];
  seasonalityFactor: number[];
  peakMonth: number;
};

const SEP = '\t';
const BATCH_SIZE = 500;

function key(...parts: string[]): string {
  return parts.join(SEP);
}

function finiteQty(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, value ?? 0) : 0;
}

function aggregateHistory(
  source: Map<string, number>,
  skuById: Map<string, { projectGroup: string; category: string }>,
  startMonth: string,
) {
  const group = new Map<string, Map<string, number>>();
  const category = new Map<string, Map<string, number>>();
  const platform = new Map<string, Map<string, number>>();
  const skuPlatforms = new Map<string, Set<string>>();
  const historyPeriods = new Set<string>();

  for (const [rawKey, rawQty] of source) {
    const [skuId, rawPlatform, period] = rawKey.split(SEP);
    const sku = skuId ? skuById.get(skuId) : undefined;
    if (!sku || !rawPlatform || !period || period >= startMonth) continue;

    const qty = finiteQty(rawQty);
    const platformCode = rawPlatform.trim().toUpperCase();
    historyPeriods.add(period);
    skuPlatforms.set(skuId!, new Set([...(skuPlatforms.get(skuId!) ?? []), platformCode]));

    const add = (map: Map<string, Map<string, number>>, dimension: string) => {
      const byPeriod = map.get(dimension) ?? new Map<string, number>();
      byPeriod.set(period, (byPeriod.get(period) ?? 0) + qty);
      map.set(dimension, byPeriod);
    };
    add(group, sku.projectGroup);
    add(category, key(sku.projectGroup, sku.category));
    add(platform, key(sku.projectGroup, sku.category, platformCode));
  }

  return {
    group,
    category,
    platform,
    skuPlatforms,
    historyPeriods: [...historyPeriods].sort(),
  };
}

function buildForecast(
  history: Map<string, number> | undefined,
  historyPeriods: string[],
  horizonPeriods: string[],
): DimensionForecast {
  return extrapolateTrendSeasonal(
    historyPeriods.map((period) => history?.get(period) ?? 0),
    historyPeriods,
    horizonPeriods,
  );
}

function node(
  level: LayeredNodeDraft['level'],
  projectGroup: string,
  category: string,
  platform: string,
  skuId: string | null,
  period: string,
  qty: number,
  forecast?: DimensionForecast,
  index = 0,
  draftQty: number | null = null,
): LayeredNodeDraft {
  return {
    level,
    projectGroup,
    category,
    platform,
    skuId,
    period,
    qty,
    systemQty: qty,
    draftQty,
    locked: false,
    seasonalityFactor: forecast?.seasonalityFactor[index] ?? null,
    trendFactor: null,
    peakMonth: forecast?.peakMonth ?? null,
    manualEdited: false,
  };
}

/**
 * Builds a complete in-memory hierarchy. Node identity uses:
 * - group: `(projectGroup, ALL, ALL, period)`
 * - category: `(projectGroup, categoryLeaf, ALL, period)`
 * - platform: `(projectGroup, categoryLeaf, platform, period)`
 * - SKU: `(projectGroup, categoryLeaf, platform, skuId, period)`.
 *
 * History on or after `startMonth` is deliberately ignored to keep backtests
 * free from future leakage.
 */
export function buildLayeredNodesFromAggregates(input: {
  startMonth: string;
  horizonMonths: number;
  skus: SkuInput[];
  monthlyBySkuPlatform: Map<string, number>;
  recent90BySkuPlatform: Map<string, number>;
}): LayeredNodeDraft[] {
  const horizonPeriods = buildHorizonPeriods(input.startMonth, input.horizonMonths);
  const skuById = new Map(
    input.skus.map((sku) => [
      sku.id,
      {
        projectGroup: normalizeProjectGroup(sku.projectGroup),
        category: categoryLeaf(sku.category),
      },
    ]),
  );
  const skuEntries = input.skus.map((sku) => ({
    id: sku.id,
    ...(skuById.get(sku.id)!),
  }));
  const aggregated = aggregateHistory(input.monthlyBySkuPlatform, skuById, input.startMonth);
  for (const rawKey of input.recent90BySkuPlatform.keys()) {
    const [skuId, rawPlatform] = rawKey.split(SEP);
    if (!skuId || !rawPlatform || !skuById.has(skuId)) continue;
    const platforms = aggregated.skuPlatforms.get(skuId) ?? new Set<string>();
    platforms.add(rawPlatform.trim().toUpperCase());
    aggregated.skuPlatforms.set(skuId, platforms);
  }

  const groups = [...new Set(skuEntries.map((sku) => sku.projectGroup))].sort();
  const categoriesByGroup = new Map<string, string[]>();
  for (const sku of skuEntries) {
    const categories = categoriesByGroup.get(sku.projectGroup) ?? [];
    if (!categories.includes(sku.category)) categories.push(sku.category);
    categoriesByGroup.set(sku.projectGroup, categories.sort());
  }

  const groupForecasts = new Map<string, DimensionForecast>();
  const categoryForecasts = new Map<string, DimensionForecast>();
  const nodes: LayeredNodeDraft[] = [];

  for (const projectGroup of groups) {
    const groupForecast = buildForecast(
      aggregated.group.get(projectGroup),
      aggregated.historyPeriods,
      horizonPeriods,
    );
    groupForecasts.set(projectGroup, groupForecast);

    const categories = categoriesByGroup.get(projectGroup) ?? [];
    const independentCategories = categories.map((category) => {
      const dimension = key(projectGroup, category);
      const forecast = buildForecast(
        aggregated.category.get(dimension),
        aggregated.historyPeriods,
        horizonPeriods,
      );
      categoryForecasts.set(dimension, forecast);
      return { category, dimension, forecast };
    });

    for (const [periodIndex, period] of horizonPeriods.entries()) {
      const categoryQty = scaleChildrenToParent(
        groupForecast.qty[periodIndex] ?? 0,
        independentCategories.map((item) => item.forecast.qty[periodIndex] ?? 0),
      );
      nodes.push(
        node(
          'project_group',
          projectGroup,
          LAYERED_PLATFORM_ALL,
          LAYERED_PLATFORM_ALL,
          null,
          period,
          groupForecast.qty[periodIndex] ?? 0,
          groupForecast,
          periodIndex,
        ),
      );

      for (const [categoryIndex, categoryItem] of independentCategories.entries()) {
        const categoryTotal = categoryQty[categoryIndex] ?? 0;
        nodes.push(
          node(
            'category',
            projectGroup,
            categoryItem.category,
            LAYERED_PLATFORM_ALL,
            null,
            period,
            categoryTotal,
            categoryItem.forecast,
            periodIndex,
          ),
        );

        const categorySkus = skuEntries.filter(
          (sku) => sku.projectGroup === projectGroup && sku.category === categoryItem.category,
        );
        const platforms = [
          ...new Set(
            categorySkus.flatMap((sku) => [...(aggregated.skuPlatforms.get(sku.id) ?? [])]),
          ),
        ].sort();
        const independentPlatforms = platforms.map((platform) => {
          const dimension = key(projectGroup, categoryItem.category, platform);
          const forecast = buildForecast(
            aggregated.platform.get(dimension),
            aggregated.historyPeriods,
            horizonPeriods,
          );
          return { platform, dimension, forecast };
        });
        const platformQty = scaleChildrenToParent(
          categoryTotal,
          independentPlatforms.map((item) => item.forecast.qty[periodIndex] ?? 0),
        );

        for (const [platformIndex, platformItem] of independentPlatforms.entries()) {
          const parentQty = platformQty[platformIndex] ?? 0;
          nodes.push(
            node(
              'platform',
              projectGroup,
              categoryItem.category,
              platformItem.platform,
              null,
              period,
              parentQty,
              platformItem.forecast,
              periodIndex,
            ),
          );

          const platformSkus = categorySkus.filter((sku) =>
            (aggregated.skuPlatforms.get(sku.id) ?? new Set()).has(platformItem.platform),
          );
          const reconciled = reconcileUnlocked({
            parentQty,
            items: platformSkus.map((sku) => {
              const seasonalityFactor = categoryItem.forecast.seasonalityFactor[periodIndex] ?? 1;
              return {
                id: sku.id,
                qty: 0,
                locked: false,
                recent90Qty: finiteQty(input.recent90BySkuPlatform.get(key(sku.id, platformItem.platform))),
                draftQty: computeSkuDraftQty({
                  recent90Qty: finiteQty(
                    input.recent90BySkuPlatform.get(key(sku.id, platformItem.platform)),
                  ),
                  period,
                  seasonalityFactor,
                }),
              };
            }),
          });
          for (const sku of platformSkus) {
            const result = reconciled.find((item) => item.id === sku.id);
            const draftQty = computeSkuDraftQty({
              recent90Qty: finiteQty(
                input.recent90BySkuPlatform.get(key(sku.id, platformItem.platform)),
              ),
              period,
              seasonalityFactor: categoryItem.forecast.seasonalityFactor[periodIndex] ?? 1,
            });
            nodes.push(
              node(
                'sku',
                projectGroup,
                categoryItem.category,
                platformItem.platform,
                sku.id,
                period,
                result?.qty ?? 0,
                categoryItem.forecast,
                periodIndex,
                draftQty,
              ),
            );
          }
        }
      }
    }
  }

  return nodes;
}

function normalizeV41Platform(raw: string | null): string {
  const normalized = normalizeSalesPlatform(raw);
  return (FORECAST_V41_PLATFORM_CODES as readonly string[]).includes(normalized)
    ? normalized
    : 'UNKNOWN';
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function subtractDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}

function versionNo(now: Date): string {
  const stamp = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('');
  const time = [
    String(now.getUTCHours()).padStart(2, '0'),
    String(now.getUTCMinutes()).padStart(2, '0'),
    String(now.getUTCSeconds()).padStart(2, '0'),
  ].join('');
  return `LF-${stamp}-${time}`;
}

export async function generateLayeredForecastVersion(input: {
  startMonth?: string;
  horizonMonths?: number;
  projectGroup?: string;
  category?: string;
  createdBy?: string | null;
  now?: Date;
}): Promise<{ versionId: string; versionNo: string; nodeCount: number }> {
  const now = input.now ?? new Date();
  const { startMonth, asOf } = parseAndValidateForecastStartMonth(input.startMonth, now);
  const horizonMonths = input.horizonMonths ?? 12;
  if (!Number.isInteger(horizonMonths) || horizonMonths < 1 || horizonMonths > 18) {
    throw new Error('horizonMonths 须为 1 到 18 的整数');
  }

  const projectGroupFilter = input.projectGroup?.trim();
  const categoryFilter = input.category?.trim();
  let skuRows = await db
    .select({ id: skus.id, projectGroup: skus.projectGroup, category: skus.category })
    .from(skus)
    .where(eq(skus.isActive, true));
  if (projectGroupFilter) {
    skuRows = skuRows.filter(
      (sku) => normalizeProjectGroup(sku.projectGroup) === normalizeProjectGroup(projectGroupFilter),
    );
  }
  if (categoryFilter) {
    skuRows = skuRows.filter((sku) => skuMatchesCategoryFilter(sku.category, categoryFilter));
  }

  const skuIds = skuRows.map((sku) => sku.id);
  const monthlyBySkuPlatform = new Map<string, number>();
  const recent90BySkuPlatform = new Map<string, number>();
  if (skuIds.length) {
    const asOfDate = dateOnly(asOf);
    const recent90Date = dateOnly(subtractDays(asOf, 90));
    const salesRows = await db
      .select({
        skuId: salesHistory.skuId,
        saleDate: salesHistory.saleDate,
        qtySold: salesHistory.qtySold,
        channel: salesHistory.channel,
      })
      .from(salesHistory)
      .where(and(inArray(salesHistory.skuId, skuIds), lt(salesHistory.saleDate, asOfDate)));
    for (const row of salesRows) {
      const platform = normalizeV41Platform(row.channel);
      const saleDate = String(row.saleDate).slice(0, 10);
      const period = saleDate.slice(0, 7);
      const monthlyKey = key(row.skuId, platform, period);
      monthlyBySkuPlatform.set(
        monthlyKey,
        (monthlyBySkuPlatform.get(monthlyKey) ?? 0) + finiteQty(Number(row.qtySold)),
      );
      if (saleDate >= recent90Date) {
        const recentKey = key(row.skuId, platform);
        recent90BySkuPlatform.set(
          recentKey,
          (recent90BySkuPlatform.get(recentKey) ?? 0) + finiteQty(Number(row.qtySold)),
        );
      }
    }
  }

  const drafts = buildLayeredNodesFromAggregates({
    startMonth,
    horizonMonths,
    skus: skuRows,
    monthlyBySkuPlatform,
    recent90BySkuPlatform,
  });
  const newVersionNo = versionNo(now);

  const versionId = await db.transaction(async (tx) => {
    const [version] = await tx
      .insert(layeredForecastVersions)
      .values({
        versionNo: newVersionNo,
        versionName: `分层销量预测 ${startMonth}`,
        status: 'draft',
        startMonth,
        horizonMonths,
        station: LAYERED_PLATFORM_ALL,
        algoMeta: {
          categoryRule: 'leaf',
          platforms: [...FORECAST_V41_PLATFORM_CODES],
          zeroDraftRule: 'recent90_then_equal',
        },
        createdBy: input.createdBy ?? null,
      })
      .returning({ id: layeredForecastVersions.id });
    if (!version) throw new Error('创建分层预测版本失败');

    for (let offset = 0; offset < drafts.length; offset += BATCH_SIZE) {
      const batch = drafts.slice(offset, offset + BATCH_SIZE);
      if (!batch.length) continue;
      await tx.insert(layeredForecastNodes).values(
        batch.map((draft) => ({
          versionId: version.id,
          level: draft.level,
          projectGroup: draft.projectGroup,
          category: draft.category,
          platform: draft.platform,
          skuId: draft.skuId,
          period: draft.period,
          qty: String(draft.qty),
          systemQty: String(draft.systemQty),
          draftQty: draft.draftQty == null ? null : String(draft.draftQty),
          locked: draft.locked,
          seasonalityFactor:
            draft.seasonalityFactor == null ? null : String(draft.seasonalityFactor),
          trendFactor: draft.trendFactor == null ? null : String(draft.trendFactor),
          peakMonth: draft.peakMonth,
          manualEdited: draft.manualEdited,
        })),
      );
    }
    return version.id;
  });

  return { versionId, versionNo: newVersionNo, nodeCount: drafts.length };
}
