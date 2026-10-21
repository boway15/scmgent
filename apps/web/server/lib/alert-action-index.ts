import { sql } from 'drizzle-orm';
import { db, inventoryDailySnapshots, inventoryHealthSnapshots, salesHistory, skus } from '@scm/db';
import { getShanghaiBusinessDate } from './inventory-daily-snapshot.js';
import { IN_PRODUCTION_WAREHOUSE } from './inventory-constants.js';
import { productScopeOnSkuAlias, type ProductScope } from './planning-accessory-filter.js';
import {
  clearWarehouseShippingLeadCache,
  loadWarehouseShippingLeadMap,
  shippingLeadFor,
} from './alert-ship-lead.js';
import { buildPlanningExcludedSqlCondition } from './commercial-status.js';
import {
  alertOwnerLabel,
  daysUntilDate,
  fullCoverageDays,
  isAlertNoise,
  matchesInventoryRiskView,
  resolveAlertAction,
  resolveAlertLevel,
  type AlertAction,
  type AlertActionView,
  type AlertLevel,
  type PriceReason,
} from './alert-action.js';
import type { SkuNetworkClassified } from './alert-sku-network-classify.js';

export type ClassifiedAlert = {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseCode: string | null;
  projectGroup: string | null;
  action: AlertAction;
  priceReason: PriceReason | null;
  level: AlertLevel | null;
  ownerLabel: string;
  hasShippableLots: boolean;
  hasUnallocatedLocal: boolean;
  onHandCoverageDays: number | null;
  daysToStockout: number | null;
  coverageDays: number | null;
  bandDays: number | null;
};

export type InventoryRiskCounts = Record<AlertActionView, number>;

const CACHE_MS = 60_000;

type CacheEntry = { at: number; rows: ClassifiedAlert[] };
const cache = new Map<ProductScope, CacheEntry>();
const classifiedInflight = new Map<ProductScope, Promise<ClassifiedAlert[]>>();

type NetworkCacheEntry = { at: number; rows: SkuNetworkClassified[] };
const networkCache = new Map<ProductScope, NetworkCacheEntry>();
const networkInflight = new Map<ProductScope, Promise<SkuNetworkClassified[]>>();

let cacheGeneration = 0;

export function invalidateAlertActionCache(): void {
  cacheGeneration += 1;
  cache.clear();
  networkCache.clear();
  classifiedInflight.clear();
  networkInflight.clear();
  clearWarehouseShippingLeadCache();
}

type RawRow = {
  id: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  warehouseCode: string | null;
  projectGroup: string | null;
  avgDaily: number | string | null;
  stockout: string | null;
  demandShare: string | null;
  coverage: string | null;
  localQty: number | string | null;
  profileClass: string | null;
  hasOpen: boolean | null;
  shippable: boolean | null;
  unallocatedLocalQty: number | string | null;
  totalLeadDays: number | string | null;
};

function asBool(value: unknown): boolean {
  return value === true || value === 't' || value === 'true';
}

function finite(value: number | string | null | undefined): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function classifyAlertRows(
  rows: RawRow[],
  today: string,
  shippingLead?: Map<string, number | null>,
): ClassifiedAlert[] {
  return rows.map((row) => {
    const avgDaily = finite(row.avgDaily);
    const demandShare = finite(row.demandShare);
    const confirmedCoverage = finite(row.coverage);
    const hasOpenLots = asBool(row.hasOpen);
    const shippable = asBool(row.shippable);
    const unallocatedLocalQty = finite(row.unallocatedLocalQty) ?? 0;
    const hasUnallocatedLocal = unallocatedLocalQty > 0 && (demandShare ?? 0) > 0;
    const shipDays = daysUntilDate(today, row.stockout);
    const localQty = finite(row.localQty) ?? 0;
    const totalLeadDays = finite(row.totalLeadDays);
    const fullDays = fullCoverageDays({
      shipDays,
      confirmedCoverageDays: confirmedCoverage,
      localQty,
      avgDaily,
    });
    const warehouseCode = row.warehouseCode ?? '';
    const resolved = resolveAlertAction({
      shipDays,
      fullDays,
      shippingLeadDays: shippingLeadFor(warehouseCode, shippingLead),
      hasShippableLots: shippable,
      noise: isAlertNoise({ avgDaily, demandShare, hasOpenLots }),
      totalLeadDays,
    });
    const level = resolveAlertLevel({
      action: resolved.action,
      shipDays,
      profileClass: row.profileClass,
      fullDays,
      totalLeadDays,
    });
    const usesShipDays = resolved.action === 'price' || resolved.action === 'ship_urgent' || resolved.action === 'ship';
    return {
      id: row.id,
      skuId: row.skuId,
      skuCode: row.skuCode,
      skuName: row.skuName ?? '',
      warehouseCode: row.warehouseCode,
      projectGroup: row.projectGroup,
      action: resolved.action,
      priceReason: resolved.priceReason,
      level,
      ownerLabel: alertOwnerLabel(resolved.action, level),
      hasShippableLots: shippable,
      hasUnallocatedLocal,
      onHandCoverageDays: shipDays ?? confirmedCoverage,
      daysToStockout: shipDays,
      coverageDays: fullDays,
      bandDays: usesShipDays ? shipDays : fullDays,
    };
  });
}

export function countRiskSkus(rows: ClassifiedAlert[]): InventoryRiskCounts {
  const sets: Record<AlertActionView, Set<string>> = {
    stockout_now: new Set(),
    stockout_imminent: new Set(),
    price: new Set(),
    ship_urgent: new Set(),
    ship: new Set(),
    order_tight: new Set(),
    order: new Set(),
    healthy: new Set(),
    mild_overstock: new Set(),
    overstock: new Set(),
    confirmed_slow: new Set(),
  };
  for (const row of rows) {
    if (row.action === 'none') continue;
    if (row.action === 'price') {
      sets.price.add(row.skuId);
      if (row.priceReason === 'already_out') sets.stockout_now.add(row.skuId);
      else sets.stockout_imminent.add(row.skuId);
      continue;
    }
    sets[row.action].add(row.skuId);
  }
  return {
    stockout_now: sets.stockout_now.size,
    stockout_imminent: sets.stockout_imminent.size,
    price: sets.price.size,
    ship_urgent: sets.ship_urgent.size,
    ship: sets.ship.size,
    order_tight: sets.order_tight.size,
    order: sets.order.size,
    healthy: sets.healthy.size,
    mild_overstock: sets.mild_overstock.size,
    overstock: sets.overstock.size,
    confirmed_slow: sets.confirmed_slow.size,
  };
}

/** 概览卡片：按 SKU 全网分档计数（与 SKU 全网列表一致）。 */
export async function countNetworkRiskSkus(rows: ClassifiedAlert[]): Promise<InventoryRiskCounts> {
  const { classifyAlertsBySkuNetwork, countSkuNetworkRisk } = await import('./alert-sku-network-classify.js');
  const skuRows = await classifyAlertsBySkuNetwork(rows);
  return countSkuNetworkRisk(skuRows);
}

async function loadClassifiedAlerts(productScope: ProductScope): Promise<ClassifiedAlert[]> {
  const hit = cache.get(productScope);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const pending = classifiedInflight.get(productScope);
  if (pending) return pending;

  const generation = cacheGeneration;
  const promise = queryClassifiedAlerts(productScope)
    .then((rows) => {
      if (generation === cacheGeneration) cache.set(productScope, { at: Date.now(), rows });
      return rows;
    })
    .finally(() => {
      if (classifiedInflight.get(productScope) === promise) classifiedInflight.delete(productScope);
    });
  classifiedInflight.set(productScope, promise);
  return promise;
}

async function queryClassifiedAlerts(productScope: ProductScope): Promise<ClassifiedAlert[]> {
  const today = getShanghaiBusinessDate();
  const queryResult = await db.execute(sql`
    WITH lots AS (
      SELECT
        sku_id,
        warehouse_code,
        true AS has_open,
        bool_or(
          pool = 'local'
          AND warehouse_code <> ${IN_PRODUCTION_WAREHOUSE}
          AND coalesce(production_status::text, '') <> 'qc_pending'
          AND (
            production_status::text = 'completed'
            OR (ship_ready_at IS NOT NULL AND ship_ready_at <= ${today}::date)
          )
        ) AS shippable,
        coalesce(sum(CASE WHEN pool = 'local' THEN qty ELSE 0 END), 0)::int AS local_qty
      FROM inventory_supply_lots
      WHERE status = 'open'
      GROUP BY sku_id, warehouse_code
    )
    SELECT
      a.id::text AS id,
      a.sku_id::text AS "skuId",
      s.code AS "skuCode",
      s.name AS "skuName",
      s.project_group AS "projectGroup",
      a.warehouse_code AS "warehouseCode",
      h.avg_daily AS "avgDaily",
      h.j->>'timelineStockoutDate' AS stockout,
      h.j->>'demandShare' AS "demandShare",
      h.total_lead_days AS "totalLeadDays",
      COALESCE(h.j->>'confirmedCoverageDays', h.coverage_days::text) AS coverage,
      l.local_qty AS "localQty",
      fc.profile_class AS "profileClass",
      l.has_open AS "hasOpen",
      l.shippable AS shippable,
      u.unallocated_local AS "unallocatedLocalQty"
    FROM stock_alerts a
    JOIN skus s ON s.id = a.sku_id
    LEFT JOIN LATERAL (
      SELECT
        avg_daily,
        coverage_days,
        total_lead_days,
        CASE
          WHEN jsonb_typeof(metrics) = 'string' THEN (metrics #>> '{}')::jsonb
          WHEN jsonb_typeof(metrics) = 'object' THEN metrics
          ELSE NULL
        END AS j
      FROM inventory_health_snapshots
      WHERE sku_id = a.sku_id AND warehouse_code = a.warehouse_code
      ORDER BY computed_at DESC
      LIMIT 1
    ) h ON true
    LEFT JOIN lots l ON l.sku_id = a.sku_id AND l.warehouse_code = a.warehouse_code
    LEFT JOIN (
      SELECT sku_id, coalesce(sum(qty), 0)::int AS unallocated_local
      FROM inventory_supply_lots
      WHERE status = 'open'
        AND pool = 'local'
        AND warehouse_code = ${IN_PRODUCTION_WAREHOUSE}
      GROUP BY sku_id
    ) u ON u.sku_id = a.sku_id
    LEFT JOIN LATERAL (
      SELECT m.forecast_profile_class AS profile_class
      FROM sales_forecast_monthly m
      INNER JOIN sales_forecast_versions v ON v.id = m.version_id
      WHERE m.sku_id = a.sku_id
        AND v.status = 'published'
        AND m.forecast_profile_class IS NOT NULL
      ORDER BY v.published_at DESC NULLS LAST
      LIMIT 1
    ) fc ON true
    WHERE a.is_resolved = false
    ${productScopeOnSkuAlias(productScope, 's')}
  `);

  const shippingLead = await loadWarehouseShippingLeadMap();
  return classifyAlertRows(Array.from(queryResult as unknown as RawRow[]), today, shippingLead);
}

/** 与规划驾驶舱可规划 SKU 同口径：近 30 天周转或近 90 天有销，且非疑似停售。 */
const ELIGIBLE_TURNOVER_LOOKBACK_DAYS = 30;
const ELIGIBLE_SALES_LOOKBACK_DAYS = 90;

const planningExcludedSql = buildPlanningExcludedSqlCondition({
  lifecycleColumnSql: 's.lifecycle',
  commercialStatusNormColumnSql: 's.commercial_status_norm',
});

type EligibleSkuSeed = {
  skuId: string;
  skuCode: string;
  skuName: string;
  projectGroup: string | null;
  warehouseCode: string | null;
};

function seedClassifiedAlert(seed: EligibleSkuSeed): ClassifiedAlert {
  return {
    id: `sku:${seed.skuId}`,
    skuId: seed.skuId,
    skuCode: seed.skuCode,
    skuName: seed.skuName ?? '',
    warehouseCode: seed.warehouseCode,
    projectGroup: seed.projectGroup,
    action: 'none',
    priceReason: null,
    level: null,
    ownerLabel: '',
    hasShippableLots: false,
    hasUnallocatedLocal: false,
    onHandCoverageDays: null,
    daysToStockout: null,
    coverageDays: null,
    bandDays: null,
  };
}

async function loadPlanningEligibleSeeds(productScope: ProductScope): Promise<EligibleSkuSeed[]> {
  const skuScopeSql = productScopeOnSkuAlias(productScope, 's');
  const result = await db.execute(sql`
    SELECT
      s.id::text AS "skuId",
      s.code AS "skuCode",
      s.name AS "skuName",
      s.project_group AS "projectGroup",
      h.warehouse_code AS "warehouseCode"
    FROM ${skus} s
    LEFT JOIN LATERAL (
      SELECT warehouse_code
      FROM ${inventoryHealthSnapshots}
      WHERE sku_id = s.id
      ORDER BY computed_at DESC
      LIMIT 1
    ) h ON true
    WHERE s.is_active = true
      ${skuScopeSql}
      AND (
        EXISTS (
          SELECT 1
          FROM ${inventoryDailySnapshots} ids
          WHERE ids.sku_id = s.id
            AND ids.snapshot_date >= (CURRENT_DATE - ${sql.raw(String(ELIGIBLE_TURNOVER_LOOKBACK_DAYS))} * INTERVAL '1 day')
        )
        OR EXISTS (
          SELECT 1
          FROM ${salesHistory} sh
          WHERE sh.sku_id = s.id
            AND sh.sale_date >= (CURRENT_DATE - ${sql.raw(String(ELIGIBLE_SALES_LOOKBACK_DAYS))} * INTERVAL '1 day')
            AND sh.qty_sold > 0
        )
      )
      AND NOT ${sql.raw(planningExcludedSql)}
  `);
  return Array.from(result as unknown as EligibleSkuSeed[]);
}

export async function mergePlanningEligibleAlertRows(
  rows: ClassifiedAlert[],
  productScope: ProductScope,
): Promise<ClassifiedAlert[]> {
  const seeds = await loadPlanningEligibleSeeds(productScope);
  if (!seeds.length) return rows;
  const seen = new Set(rows.map((row) => row.skuId));
  const extra = seeds.filter((seed) => !seen.has(seed.skuId)).map(seedClassifiedAlert);
  return extra.length ? rows.concat(extra) : rows;
}

export async function loadNetworkAlertUniverse(productScope: ProductScope): Promise<ClassifiedAlert[]> {
  const rows = await loadClassifiedAlerts(productScope);
  return mergePlanningEligibleAlertRows(rows, productScope);
}

async function loadSkuNetworkClassified(productScope: ProductScope): Promise<SkuNetworkClassified[]> {
  const hit = networkCache.get(productScope);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.rows;
  const pending = networkInflight.get(productScope);
  if (pending) return pending;

  const generation = cacheGeneration;
  const promise = (async () => {
    const { classifyAlertsBySkuNetwork } = await import('./alert-sku-network-classify.js');
    const universe = await loadNetworkAlertUniverse(productScope);
    return classifyAlertsBySkuNetwork(universe);
  })()
    .then((rows) => {
      if (generation === cacheGeneration) networkCache.set(productScope, { at: Date.now(), rows });
      return rows;
    })
    .finally(() => {
      if (networkInflight.get(productScope) === promise) networkInflight.delete(productScope);
    });
  networkInflight.set(productScope, promise);
  return promise;
}

export async function getInventoryRiskCounts(productScope: ProductScope): Promise<InventoryRiskCounts> {
  const { countSkuNetworkRisk } = await import('./alert-sku-network-classify.js');
  return countSkuNetworkRisk(await loadSkuNetworkClassified(productScope));
}

const LEVEL_RANK: Record<string, number> = { l3: 0, l2: 1, l1: 2 };

export async function listClassifiedAlerts(input: {
  productScope: ProductScope;
  action?: AlertActionView | 'all';
  level?: AlertLevel;
  priceReason?: PriceReason;
  q?: string;
}): Promise<ClassifiedAlert[]> {
  const needle = input.q?.trim().toLowerCase();
  const rows = (await loadClassifiedAlerts(input.productScope)).filter((row) => {
    if (row.action === 'none') return false;
    if (input.action && input.action !== 'all') {
      if (
        !matchesInventoryRiskView({
          action: row.action,
          priceReason: row.priceReason,
          view: input.action,
        })
      ) {
        return false;
      }
    }
    if (input.level && row.level !== input.level) return false;
    if (input.priceReason && row.priceReason !== input.priceReason) return false;
    return true;
  });
  const matched = needle
    ? rows.filter(
        (row) =>
          row.skuCode.toLowerCase().includes(needle) || row.skuName.toLowerCase().includes(needle),
      )
    : rows;
  return matched.sort((a, b) => {
    const levelDelta = (LEVEL_RANK[a.level ?? ''] ?? 3) - (LEVEL_RANK[b.level ?? ''] ?? 3);
    if (levelDelta !== 0) return levelDelta;
    return (a.bandDays ?? 9999) - (b.bandDays ?? 9999);
  });
}

export async function listSkuNetworkAlerts(input: {
  productScope: ProductScope;
  action?: AlertActionView | 'all';
  level?: AlertLevel;
  q?: string;
}) {
  const { filterSkuNetworkByView } = await import('./alert-sku-network-classify.js');
  let rows = filterSkuNetworkByView(
    await loadSkuNetworkClassified(input.productScope),
    input.action && input.action !== 'all' ? input.action : 'all',
  );
  if (input.level) rows = rows.filter((row) => row.level === input.level);
  const needle = input.q?.trim().toLowerCase();
  if (needle) {
    rows = rows.filter(
      (row) =>
        row.skuCode.toLowerCase().includes(needle) || row.skuName.toLowerCase().includes(needle),
    );
  }
  return rows;
}
