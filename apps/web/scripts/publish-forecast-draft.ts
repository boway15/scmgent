/**
 * 将指定草稿升为 published，并归档同站旧主发布版（可选）。
 * pnpm --filter @scm/web exec tsx scripts/publish-forecast-draft.ts
 *
 * env:
 *   VERSION_NO=DRAFT-1794197424316
 *   ARCHIVE_PREVIOUS=1（默认）归档此前主 published
 *   GUARD_OVERRIDE_REASON=... 总量护栏人工放行理由
 *   PUBLISHED_BY=local-docker-publish
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { desc, eq } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions, skus, users } from '@scm/db';
import {
  applyAggregateGuardOverride,
  loadAggregateGuardIssues,
} from '../server/lib/forecast-aggregate-guard.js';
import {
  hasBlockingForecastIssues,
  validateForecastRows,
  type ForecastRowInput,
} from '../server/lib/forecast-validation.js';
import { mapForecastDailyFields } from '../server/lib/forecast-demand.js';
import {
  archiveForecastVersion,
  assertForecastVersionEligibleForReplenishment,
  getPrimaryPublishedVersionId,
  publishForecastVersion,
} from '../server/lib/forecast-version.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const VERSION_NO = process.env.VERSION_NO || 'DRAFT-1794197424316';
const ARCHIVE_PREVIOUS = process.env.ARCHIVE_PREVIOUS !== '0';
const GUARD_OVERRIDE_REASON =
  process.env.GUARD_OVERRIDE_REASON ||
  '本地发布：落地后再帽压爆款乐观；组合层可接受略偏保守；Top50 与形状已验收';
async function resolvePublisherId(): Promise<string> {
  const forced = process.env.PUBLISHED_BY?.trim();
  if (forced && /^[0-9a-f-]{36}$/i.test(forced)) return forced;
  const [admin] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, 'admin@scm.local'))
    .limit(1);
  if (admin) return admin.id;
  const [any] = await db.select({ id: users.id }).from(users).limit(1);
  if (!any) throw new Error('no user for publishedBy');
  return any.id;
}

async function loadRows(versionId: string): Promise<ForecastRowInput[]> {
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

async function main() {
  const [draft] = await db
    .select()
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.versionNo, VERSION_NO))
    .limit(1);
  if (!draft) throw new Error(`version not found: ${VERSION_NO}`);
  if (draft.status !== 'draft') {
    throw new Error(`expected draft, got ${draft.status} (${VERSION_NO})`);
  }

  assertForecastVersionEligibleForReplenishment(draft.startMonth);

  const rows = await loadRows(draft.id);
  const guard = await loadAggregateGuardIssues(draft.id);
  const issues = applyAggregateGuardOverride(
    [...validateForecastRows(rows), ...guard],
    GUARD_OVERRIDE_REASON,
  );
  const blocking = issues.filter((i) => i.level === 'error');
  console.log(
    JSON.stringify(
      {
        versionNo: draft.versionNo,
        versionId: draft.id,
        rowCount: rows.length,
        issueCount: issues.length,
        blockingCount: blocking.length,
        canPublish: !hasBlockingForecastIssues(issues),
        sampleIssues: issues.slice(0, 8),
      },
      null,
      2,
    ),
  );
  if (hasBlockingForecastIssues(issues)) {
    throw new Error('validation blocked publish');
  }

  const previousPrimaryId = await getPrimaryPublishedVersionId(draft.station ?? undefined);
  const [previous] = await db
    .select({
      id: salesForecastVersions.id,
      versionNo: salesForecastVersions.versionNo,
      status: salesForecastVersions.status,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, previousPrimaryId))
    .limit(1);

  const publisherId = await resolvePublisherId();
  const published = await publishForecastVersion(draft.id, publisherId);
  let archived: { id: string; versionNo: string } | null = null;
  if (
    ARCHIVE_PREVIOUS &&
    previous &&
    previous.status === 'published' &&
    previous.id !== published.id
  ) {
    const row = await archiveForecastVersion(previous.id);
    if (row) archived = { id: row.id, versionNo: row.versionNo };
  }

  const primaryId = await getPrimaryPublishedVersionId(draft.station ?? undefined);
  const publishedList = await db
    .select({
      versionNo: salesForecastVersions.versionNo,
      status: salesForecastVersions.status,
      publishedAt: salesForecastVersions.publishedAt,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.status, 'published'))
    .orderBy(desc(salesForecastVersions.publishedAt))
    .limit(5);

  console.log(
    JSON.stringify(
      {
        published: {
          id: published.id,
          versionNo: published.versionNo,
          status: published.status,
          publishedAt: published.publishedAt,
          publishedBy: published.publishedBy,
        },
        archivedPrevious: archived,
        primaryId,
        primaryIsNew: primaryId === published.id,
        publishedList,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
