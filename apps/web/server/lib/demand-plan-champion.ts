/** 周预测版本绑定的 champion 月预测版本解析 */

import { eq } from 'drizzle-orm';
import { db, salesForecastVersions } from '@scm/db';
import { resolvePublishedVersionIdForSku } from './forecast-published-resolve.js';

export type DemandPlanChampionForecastVersion = {
  id: string;
  versionNo: string;
  versionName: string;
};

export async function loadChampionForecastVersionById(
  versionId: string | null | undefined,
): Promise<DemandPlanChampionForecastVersion | null> {
  const id = versionId?.trim();
  if (!id) return null;
  const [row] = await db
    .select({
      id: salesForecastVersions.id,
      versionNo: salesForecastVersions.versionNo,
      versionName: salesForecastVersions.versionName,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    versionNo: row.versionNo,
    versionName: row.versionName,
  };
}

/** 优先版本冻结 id；否则按样例 SKU 解析最新 published */
export async function resolveDemandPlanChampionForecastVersion(input: {
  frozenVersionId?: string | null;
  sampleSkuId?: string | null;
}): Promise<DemandPlanChampionForecastVersion | null> {
  const frozen = await loadChampionForecastVersionById(input.frozenVersionId);
  if (frozen) return frozen;
  if (!input.sampleSkuId) return null;
  const resolvedId = await resolvePublishedVersionIdForSku(input.sampleSkuId);
  return loadChampionForecastVersionById(resolvedId);
}

/** 从 SKU→versionId 计数中取众数作为默认 champion 版本 */
export function pickModeChampionVersionId(
  versionIds: Array<string | null | undefined>,
): { defaultVersionId: string | null; versionCounts: Record<string, number>; skuWithoutForecastCount: number } {
  const versionCounts: Record<string, number> = {};
  let skuWithoutForecastCount = 0;
  for (const id of versionIds) {
    if (!id) {
      skuWithoutForecastCount += 1;
      continue;
    }
    versionCounts[id] = (versionCounts[id] ?? 0) + 1;
  }
  let defaultVersionId: string | null = null;
  let best = 0;
  for (const [id, count] of Object.entries(versionCounts)) {
    if (count > best) {
      best = count;
      defaultVersionId = id;
    }
  }
  return { defaultVersionId, versionCounts, skuWithoutForecastCount };
}
