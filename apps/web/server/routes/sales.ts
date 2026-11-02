import { eq, and, or, gte, lte, desc, sql, type SQL } from 'drizzle-orm';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { db, salesHistory, salesHistoryMonthly, skus } from '@scm/db';
import { buildCsv, csvAttachment } from '../lib/csv-export.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { searchSkuCategories, categoryMatchesFilterCondition } from '../lib/sku-category.js';
import { getSalesImportPolicy } from '../lib/sales-import-policy.js';
import {
  resolveRequestProjectGroupScope,
  resolveScopedProjectGroups,
} from '../lib/data-scope.js';

import { requireMenu } from '../lib/rbac.js';
import { parseProductScope, productScopeSql } from '../lib/planning-accessory-filter.js';

export const salesRoutes = new Hono();

async function resolveSalesHistoryProjectGroupSql(
  c: Context,
): Promise<{ empty: boolean; condition?: SQL }> {
  const scope = await resolveRequestProjectGroupScope(c);
  const scoped = resolveScopedProjectGroups({
    scope,
    projectGroup: c.req.query('projectGroup'),
    projectGroups: c.req.queries('projectGroups'),
  });
  return { empty: scoped.empty, condition: scoped.condition };
}

function parseSalesFilters(
  c: { req: { query: (k: string) => string | undefined } },
  extraConditions: SQL[] = [],
) {
  const skuCode = c.req.query('skuCode')?.trim();
  const from = c.req.query('from')?.trim();
  const to = c.req.query('to')?.trim();
  const channel = c.req.query('channel')?.trim();
  const warehouse = c.req.query('warehouse')?.trim();
  const station = c.req.query('station')?.trim();
  const category = c.req.query('category')?.trim();
  const conditions = [];
  if (skuCode) conditions.push(eq(skus.code, skuCode));
  if (from) conditions.push(gte(salesHistory.saleDate, from));
  if (to) conditions.push(lte(salesHistory.saleDate, to));
  if (channel) conditions.push(eq(salesHistory.channel, channel));
  if (warehouse) conditions.push(eq(salesHistory.warehouseCode, warehouse));
  if (station === '其他') {
    conditions.push(or(eq(salesHistory.station, '其他'), eq(salesHistory.station, '')));
  } else if (station) {
    conditions.push(eq(salesHistory.station, station));
  }
  if (category) {
    const categoryCondition = categoryMatchesFilterCondition(
      salesHistory.category,
      skus.category,
      category,
    );
    if (categoryCondition) conditions.push(categoryCondition);
  }
  conditions.push(productScopeSql(parseProductScope(c.req.query('productScope'))));
  for (const extra of extraConditions) {
    conditions.push(extra);
  }
  return conditions;
}

function parseYearMonth(value: string): { year: number; month: number } | null {
  const m = value.trim().match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const year = Number.parseInt(m[1], 10);
  const month = Number.parseInt(m[2], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) return null;
  return { year, month };
}

function parseMonthlySalesFilters(
  c: { req: { query: (k: string) => string | undefined } },
  extraConditions: SQL[] = [],
) {
  const skuCode = c.req.query('skuCode')?.trim();
  const from = c.req.query('from')?.trim();
  const to = c.req.query('to')?.trim();
  const channel = c.req.query('channel')?.trim();
  const category = c.req.query('category')?.trim();
  const conditions = [];

  if (skuCode) conditions.push(eq(skus.code, skuCode));
  if (channel) conditions.push(eq(salesHistoryMonthly.channel, channel));
  if (category) {
    const categoryCondition = categoryMatchesFilterCondition(
      salesHistoryMonthly.category,
      skus.category,
      category,
    );
    if (categoryCondition) conditions.push(categoryCondition);
  }

  const fromYm = from ? parseYearMonth(from) : null;
  const toYm = to ? parseYearMonth(to) : null;
  if (fromYm) {
    conditions.push(
      sql`(${salesHistoryMonthly.saleYear} > ${fromYm.year} OR (${salesHistoryMonthly.saleYear} = ${fromYm.year} AND ${salesHistoryMonthly.month} >= ${fromYm.month}))`,
    );
  }
  if (toYm) {
    conditions.push(
      sql`(${salesHistoryMonthly.saleYear} < ${toYm.year} OR (${salesHistoryMonthly.saleYear} = ${toYm.year} AND ${salesHistoryMonthly.month} <= ${toYm.month}))`,
    );
  }

  conditions.push(productScopeSql(parseProductScope(c.req.query('productScope'))));
  for (const extra of extraConditions) {
    conditions.push(extra);
  }
  return conditions;
}

salesRoutes.get('/sales/history', requireMenu('data.sales'), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const scopeResult = await resolveSalesHistoryProjectGroupSql(c);
  if (scopeResult.empty) {
    return c.json({
      items: [],
      summary: { totalQty: 0, rowCount: 0 },
      total: 0,
      page,
      pageSize,
    });
  }
  const conditions = parseSalesFilters(c, scopeResult.condition ? [scopeResult.condition] : []);
  const where = conditions.length ? and(...conditions) : undefined;

  const base = db
    .select({
      id: salesHistory.id,
      skuId: salesHistory.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      category: sql<string | null>`coalesce(${salesHistory.category}, ${skus.category})`,
      saleDate: salesHistory.saleDate,
      qtySold: salesHistory.qtySold,
      channel: salesHistory.channel,
      station: salesHistory.station,
      warehouseCode: salesHistory.warehouseCode,
      source: salesHistory.source,
      createdAt: salesHistory.createdAt,
    })
    .from(salesHistory)
    .innerJoin(skus, eq(skus.id, salesHistory.skuId))
    .$dynamic();

  const summaryBase = db
    .select({
      totalQty: sql<number>`coalesce(sum(${salesHistory.qtySold}), 0)::int`,
      rowCount: sql<number>`count(*)::int`,
    })
    .from(salesHistory)
    .innerJoin(skus, eq(skus.id, salesHistory.skuId))
    .$dynamic();

  const [rows, summary] = await Promise.all([
    base
      .where(where)
      .orderBy(desc(salesHistory.saleDate), desc(salesHistory.createdAt))
      .limit(pageSize)
      .offset(offset),
    summaryBase.where(where),
  ]);

  return c.json({
    items: rows.map((row) => ({
      ...row,
      station: row.station?.trim() ? row.station : null,
    })),
    summary: {
      totalQty: summary[0]?.totalQty ?? 0,
      rowCount: summary[0]?.rowCount ?? 0,
    },
    total: summary[0]?.rowCount ?? 0,
    page,
    pageSize,
  });
});

salesRoutes.get('/sales/history/monthly', requireMenu('data.sales'), async (c) => {
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
  const scopeResult = await resolveSalesHistoryProjectGroupSql(c);
  if (scopeResult.empty) {
    return c.json({
      items: [],
      summary: { totalQty: 0, rowCount: 0 },
      total: 0,
      page,
      pageSize,
    });
  }
  const conditions = parseMonthlySalesFilters(
    c,
    scopeResult.condition ? [scopeResult.condition] : [],
  );
  const where = conditions.length ? and(...conditions) : undefined;

  const base = db
    .select({
      id: salesHistoryMonthly.id,
      skuId: salesHistoryMonthly.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      category: sql<string | null>`coalesce(${salesHistoryMonthly.category}, ${skus.category})`,
      saleYear: salesHistoryMonthly.saleYear,
      month: salesHistoryMonthly.month,
      qtySold: salesHistoryMonthly.qtySold,
      channel: salesHistoryMonthly.channel,
      source: salesHistoryMonthly.source,
      updatedAt: salesHistoryMonthly.updatedAt,
    })
    .from(salesHistoryMonthly)
    .innerJoin(skus, eq(skus.id, salesHistoryMonthly.skuId))
    .$dynamic();

  const summaryBase = db
    .select({
      totalQty: sql<number>`coalesce(sum(${salesHistoryMonthly.qtySold}), 0)::int`,
      rowCount: sql<number>`count(*)::int`,
    })
    .from(salesHistoryMonthly)
    .innerJoin(skus, eq(skus.id, salesHistoryMonthly.skuId))
    .$dynamic();

  const [rows, summary] = await Promise.all([
    base
      .where(where)
      .orderBy(desc(salesHistoryMonthly.saleYear), desc(salesHistoryMonthly.month), desc(skus.code))
      .limit(pageSize)
      .offset(offset),
    summaryBase.where(where),
  ]);

  return c.json({
    items: rows.map((row) => ({
      ...row,
      saleMonth: `${row.saleYear}-${String(row.month).padStart(2, '0')}`,
    })),
    summary: {
      totalQty: summary[0]?.totalQty ?? 0,
      rowCount: summary[0]?.rowCount ?? 0,
    },
    total: summary[0]?.rowCount ?? 0,
    page,
    pageSize,
  });
});

salesRoutes.get('/sales/history/export', requireMenu('data.sales'), async (c) => {
  const scopeResult = await resolveSalesHistoryProjectGroupSql(c);
  if (scopeResult.empty) {
    const scope = parseProductScope(c.req.query('productScope'));
    const scopeSuffix = scope === 'accessory' ? '-accessory' : '-goods';
    return csvAttachment(
      `sales-history-daily-${new Date().toISOString().slice(0, 10)}${scopeSuffix}.csv`,
      buildCsv(
        [
          'sku_code',
          'sku_name',
          'category',
          'sale_date',
          'qty_sold',
          'channel',
          'station',
          'warehouse_code',
        ],
        [],
      ),
    );
  }
  const conditions = parseSalesFilters(c, scopeResult.condition ? [scopeResult.condition] : []);
  const base = db
    .select({
      skuCode: skus.code,
      skuName: skus.name,
      category: sql<string | null>`coalesce(${salesHistory.category}, ${skus.category})`,
      saleDate: salesHistory.saleDate,
      qtySold: salesHistory.qtySold,
      channel: salesHistory.channel,
      station: salesHistory.station,
      warehouseCode: salesHistory.warehouseCode,
    })
    .from(salesHistory)
    .innerJoin(skus, eq(skus.id, salesHistory.skuId))
    .$dynamic();

  const rows =
    conditions.length > 0
      ? await base.where(and(...conditions)).orderBy(desc(salesHistory.saleDate)).limit(5000)
      : await base.orderBy(desc(salesHistory.saleDate)).limit(5000);

  const csv = buildCsv(
    [
      'sku_code',
      'sku_name',
      'category',
      'sale_date',
      'qty_sold',
      'channel',
      'station',
      'warehouse_code',
    ],
    rows.map((r) => [
      r.skuCode,
      r.skuName,
      r.category ?? '',
      String(r.saleDate).slice(0, 10),
      r.qtySold,
      r.channel ?? '',
      r.station?.trim() ? r.station : '',
      r.warehouseCode ?? '',
    ]),
  );
  const scope = parseProductScope(c.req.query('productScope'));
  const scopeSuffix = scope === 'accessory' ? '-accessory' : '-goods';
  return csvAttachment(
    `sales-history-daily-${new Date().toISOString().slice(0, 10)}${scopeSuffix}.csv`,
    csv,
  );
});

salesRoutes.get('/sales/history/monthly/export', requireMenu('data.sales'), async (c) => {
  const scopeResult = await resolveSalesHistoryProjectGroupSql(c);
  if (scopeResult.empty) {
    const scope = parseProductScope(c.req.query('productScope'));
    const scopeSuffix = scope === 'accessory' ? '-accessory' : '-goods';
    return csvAttachment(
      `sales-history-monthly-${new Date().toISOString().slice(0, 10)}${scopeSuffix}.csv`,
      buildCsv(['sku_code', 'sku_name', 'category', 'sale_year', 'month', 'qty_sold', 'channel'], []),
    );
  }
  const conditions = parseMonthlySalesFilters(
    c,
    scopeResult.condition ? [scopeResult.condition] : [],
  );
  const base = db
    .select({
      skuCode: skus.code,
      skuName: skus.name,
      category: sql<string | null>`coalesce(${salesHistoryMonthly.category}, ${skus.category})`,
      saleYear: salesHistoryMonthly.saleYear,
      month: salesHistoryMonthly.month,
      qtySold: salesHistoryMonthly.qtySold,
      channel: salesHistoryMonthly.channel,
    })
    .from(salesHistoryMonthly)
    .innerJoin(skus, eq(skus.id, salesHistoryMonthly.skuId))
    .$dynamic();

  const rows =
    conditions.length > 0
      ? await base
          .where(and(...conditions))
          .orderBy(desc(salesHistoryMonthly.saleYear), desc(salesHistoryMonthly.month))
          .limit(5000)
      : await base
          .orderBy(desc(salesHistoryMonthly.saleYear), desc(salesHistoryMonthly.month))
          .limit(5000);

  const csv = buildCsv(
    ['sku_code', 'sku_name', 'category', 'sale_year', 'month', 'qty_sold', 'channel'],
    rows.map((r) => [
      r.skuCode,
      r.skuName,
      r.category ?? '',
      r.saleYear,
      r.month,
      r.qtySold,
      r.channel ?? '',
    ]),
  );
  const scope = parseProductScope(c.req.query('productScope'));
  const scopeSuffix = scope === 'accessory' ? '-accessory' : '-goods';
  return csvAttachment(
    `sales-history-monthly-${new Date().toISOString().slice(0, 10)}${scopeSuffix}.csv`,
    csv,
  );
});

salesRoutes.get('/sales/import-policy', requireMenu('data.sales'), async (c) => {
  return c.json(getSalesImportPolicy());
});

salesRoutes.get('/sales/categories', requireMenu('data.sales'), async (c) => {
  const scope = await resolveRequestProjectGroupScope(c);
  const scoped = resolveScopedProjectGroups({
    scope,
    projectGroup: c.req.query('projectGroup'),
    projectGroups: c.req.queries('projectGroups'),
  });
  if (scoped.empty) return c.json([]);
  const q = c.req.query('q')?.trim();
  const limitRaw = Number.parseInt(c.req.query('limit')?.trim() ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  return c.json(await searchSkuCategories(q || undefined, limit, scoped.condition));
});
