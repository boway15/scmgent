import { eq, and, gte, lte, desc, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, salesHistory, skus } from '../_db';
import { buildCsv, csvAttachment } from '../lib/csv-export';

export const salesRoutes = new Hono();

function parseSalesFilters(c: { req: { query: (k: string) => string | undefined } }) {
  const skuCode = c.req.query('skuCode')?.trim();
  const from = c.req.query('from')?.trim();
  const to = c.req.query('to')?.trim();
  const channel = c.req.query('channel')?.trim();
  const warehouse = c.req.query('warehouse')?.trim();
  const conditions = [];
  if (skuCode) conditions.push(eq(skus.code, skuCode));
  if (from) conditions.push(gte(salesHistory.saleDate, from));
  if (to) conditions.push(lte(salesHistory.saleDate, to));
  if (channel) conditions.push(eq(salesHistory.channel, channel));
  if (warehouse) conditions.push(eq(salesHistory.warehouseCode, warehouse));
  return conditions;
}

salesRoutes.get('/sales/history', async (c) => {
  const conditions = parseSalesFilters(c);
  const limit = Math.min(Number(c.req.query('limit') ?? 200), 500);

  const base = db
    .select({
      id: salesHistory.id,
      skuId: salesHistory.skuId,
      skuCode: skus.code,
      skuName: skus.name,
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

  const rows =
    conditions.length > 0
      ? await base
          .where(and(...conditions))
          .orderBy(desc(salesHistory.saleDate), desc(salesHistory.createdAt))
          .limit(limit)
      : await base.orderBy(desc(salesHistory.saleDate), desc(salesHistory.createdAt)).limit(limit);

  const summaryBase = db
    .select({
      totalQty: sql<number>`coalesce(sum(${salesHistory.qtySold}), 0)::int`,
      rowCount: sql<number>`count(*)::int`,
    })
    .from(salesHistory)
    .innerJoin(skus, eq(skus.id, salesHistory.skuId))
    .$dynamic();

  const [summary] =
    conditions.length > 0
      ? await summaryBase.where(and(...conditions))
      : await summaryBase;

  return c.json({
    items: rows,
    summary: {
      totalQty: summary?.totalQty ?? 0,
      rowCount: summary?.rowCount ?? 0,
    },
  });
});

salesRoutes.get('/sales/history/export', async (c) => {
  const conditions = parseSalesFilters(c);
  const base = db
    .select({
      skuCode: skus.code,
      skuName: skus.name,
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
    ['sku_code', 'sku_name', 'sale_date', 'qty_sold', 'channel', 'warehouse_code'],
    rows.map((r) => [
      r.skuCode,
      r.skuName,
      String(r.saleDate).slice(0, 10),
      r.qtySold,
      r.channel ?? '',
      r.warehouseCode ?? '',
    ]),
  );
  return csvAttachment(`sales-history-${new Date().toISOString().slice(0, 10)}.csv`, csv);
});
