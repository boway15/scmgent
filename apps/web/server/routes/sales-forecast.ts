import { eq, and, desc } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, salesForecastMonthly, skus } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';
import { writeAuditLog } from '../lib/audit-log.js';

export const salesForecastRoutes = new Hono();

salesForecastRoutes.get('/sales-forecasts', requireMenu('data.import'), async (c) => {
  const skuCode = c.req.query('skuCode')?.trim();
  const station = c.req.query('station')?.trim();
  const year = c.req.query('year') ? Number(c.req.query('year')) : undefined;

  const conditions = [];
  if (skuCode) conditions.push(eq(skus.code, skuCode));
  if (station) conditions.push(eq(salesForecastMonthly.station, station));
  if (year) conditions.push(eq(salesForecastMonthly.forecastYear, year));

  const base = db
    .select({
      id: salesForecastMonthly.id,
      skuId: salesForecastMonthly.skuId,
      skuCode: skus.code,
      skuName: skus.name,
      station: salesForecastMonthly.station,
      forecastYear: salesForecastMonthly.forecastYear,
      month: salesForecastMonthly.month,
      forecastDailyAvg: salesForecastMonthly.forecastDailyAvg,
      lifecycle: salesForecastMonthly.lifecycle,
      ownerName: salesForecastMonthly.ownerName,
      source: salesForecastMonthly.source,
      updatedAt: salesForecastMonthly.updatedAt,
    })
    .from(salesForecastMonthly)
    .innerJoin(skus, eq(skus.id, salesForecastMonthly.skuId))
    .$dynamic();

  const rows =
    conditions.length > 0
      ? await base.where(and(...conditions)).orderBy(skus.code, salesForecastMonthly.month)
      : await base.orderBy(desc(salesForecastMonthly.updatedAt)).limit(500);

  return c.json({ items: rows, count: rows.length });
});

salesForecastRoutes.put('/sales-forecasts/:id', requireMenu('data.import'), async (c) => {
  const user = await getCurrentUser(c);
  const body = await c.req.json<{
    forecastDailyAvg?: number;
    lifecycle?: string;
    ownerName?: string;
  }>();

  const [existing] = await db
    .select()
    .from(salesForecastMonthly)
    .where(eq(salesForecastMonthly.id, c.req.param('id')))
    .limit(1);

  if (!existing) return c.json({ message: 'Forecast row not found' }, 404);

  const [row] = await db
    .update(salesForecastMonthly)
    .set({
      forecastDailyAvg:
        body.forecastDailyAvg != null ? String(body.forecastDailyAvg) : existing.forecastDailyAvg,
      lifecycle: body.lifecycle ?? existing.lifecycle,
      ownerName: body.ownerName ?? existing.ownerName,
      source: 'manual',
      updatedAt: new Date(),
    })
    .where(eq(salesForecastMonthly.id, existing.id))
    .returning();

  await writeAuditLog(c, {
    action: 'sales_forecast.update',
    resourceType: 'sales_forecast_monthly',
    resourceId: existing.id,
    detail: { before: existing, after: row },
    user,
  });

  return c.json(row);
});
