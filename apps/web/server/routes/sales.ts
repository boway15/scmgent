import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, salesHistory, salesHistoryMonthly, skus } from '@scm/db';
import { buildCsv, csvAttachment } from '../lib/csv-export.js';
import { parseListPagination } from '../lib/list-pagination.js';
import { searchSkuCategories, categoryMatchesFilterCondition } from '../lib/sku-category.js';
import { getSalesImportPolicy } from '../lib/sales-import-policy.js';

import { requireMenu } from '../lib/rbac.js';

export const salesRoutes = new Hono();

function parseSalesFilters(c: { req: { query: (k: string) => string | undefined } }) {
  const skuCode = c.req.query('skuCode')?.trim();
  const from = c.req.query('from')?.trim();
  const to = c.req.query('to')?.trim();
  const channel = c.req.query('channel')?.trim();
  const warehouse = c.req.query('warehouse')?.trim();
  const category = c.req.query('category')?.trim();
  const conditions = [];
  if (skuCode) conditions.push(eq(skus.code, skuCode));
  if (from) conditions.push(gte(salesHistory.saleDate, from));
  if (to) conditions.push(lte(salesHistory.saleDate, to));
  if (channel) conditions.push(eq(salesHistory.channel, channel));
  if (warehouse) conditions.push(eq(salesHistory.warehouseCode, warehouse));
  if (category) {
    const categoryCondition = categoryMatchesFilterCondition(
      salesHistory.category,
      skus.category,
      category,
    );
    if (categoryCondition) conditions.push(categoryCondition);
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

function parseMonthlySalesFilters(c: { req: { query: (k: string) => string | undefined } }) {
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

  return conditions;
}

salesRoutes.get('/sales/history', requireMenu('data.sales'), async (c) => {
  const conditions = parseSalesFilters(c);
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
  );
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
    items: rows,
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
  const conditions = parseMonthlySalesFilters(c);
  const { page, pageSize, offset } = parseListPagination(
    c.req.query('page')?.trim(),
    c.req.query('pageSize')?.trim(),
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
  const conditions = parseSalesFilters(c);
  const base = db
    .select({
      skuCode: skus.code,
      skuName: skus.name,
      category: sql<string | null>`coalesce(${salesHistory.category}, ${skus.category})`,
      saleDate: salesHistory.saleDate,
      qtySold: salesHistory.qtySold,
      channel: salesHistory.channel,
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
    ['sku_code', 'sku_name', 'category', 'sale_date', 'qty_sold', 'channel', 'warehouse_code'],
    rows.map((r) => [
      r.skuCode,
      r.skuName,
      r.category ?? '',
      String(r.saleDate).slice(0, 10),
      r.qtySold,
      r.channel ?? '',
      r.warehouseCode ?? '',
    ]),
  );
  return csvAttachment(`sales-history-daily-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

salesRoutes.get('/sales/history/monthly/export', requireMenu('data.sales'), async (c) => {
  const conditions = parseMonthlySalesFilters(c);
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
  return csvAttachment(`sales-history-monthly-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});

salesRoutes.get('/sales/import-policy', requireMenu('data.sales'), async (c) => {
  return c.json(getSalesImportPolicy());
});

salesRoutes.get('/sales/categories', requireMenu('data.sales'), async (c) => {
  const q = c.req.query('q')?.trim();
  const limitRaw = Number.parseInt(c.req.query('limit')?.trim() ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
  return c.json(await searchSkuCategories(q || undefined, limit));
});
