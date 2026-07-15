import { eq, desc } from 'drizzle-orm';
import { db, salesForecastVersions, forecastAccuracyMonthly, skus } from '@scm/db';
import { recordToolCall } from '../trace.js';
import { resolveSkuId } from './sku.js';

export async function getLatestPublishedForecastVersion(runId?: string) {
  const handler = async () => {
    const [row] = await db
      .select()
      .from(salesForecastVersions)
      .where(eq(salesForecastVersions.status, 'published'))
      .orderBy(desc(salesForecastVersions.publishedAt))
      .limit(1);
    return row ?? null;
  };

  if (runId) {
    return recordToolCall(runId, 'getLatestPublishedForecastVersion', handler);
  }
  return handler();
}

export async function getSkuForecastAccuracy(
  input: { skuId?: string; skuCode?: string },
  runId?: string,
) {
  const handler = async () => {
    const skuId = await resolveSkuId(input);
    if (!skuId) return [];

    return db
      .select({
        skuCode: skus.code,
        station: forecastAccuracyMonthly.station,
        platform: forecastAccuracyMonthly.platform,
        forecastYear: forecastAccuracyMonthly.forecastYear,
        month: forecastAccuracyMonthly.month,
        mape: forecastAccuracyMonthly.mape,
        biasRate: forecastAccuracyMonthly.biasRate,
      })
      .from(forecastAccuracyMonthly)
      .innerJoin(skus, eq(forecastAccuracyMonthly.skuId, skus.id))
      .where(eq(forecastAccuracyMonthly.skuId, skuId))
      .orderBy(desc(forecastAccuracyMonthly.forecastYear), desc(forecastAccuracyMonthly.month))
      .limit(6);
  };

  if (runId) {
    return recordToolCall(runId, 'getSkuForecastAccuracy', handler, input);
  }
  return handler();
}
