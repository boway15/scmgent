/**
 * 将影子季节指数写入系统预测（forecast_daily_avg），不写入人工校准。
 *
 * 推荐顺序（与精度回测优化口径一致）：
 * 1) 先写入**满幅** shadowDaily
 * 2) 再跑站点 SI 重塑（近端衰减，11/12 满幅）
 * 3) 最后按地平线衰减：baseV41 + α(h)·(current − baseV41)；11/12 强制满幅
 * 4) 落地后再帽
 *
 * pnpm --filter @scm/web exec tsx scripts/apply-seasonal-index-to-system.ts --version-id <uuid>
 * pnpm --filter @scm/web exec tsx scripts/apply-seasonal-index-to-system.ts --version-id <uuid> --from-shadow --with-reshape --with-horizon-decay
 * （默认在地平线衰减后追加落地后再帽；可用 --skip-post-landing-cap 关闭）
 *
 * 说明：基线生成（mode=shadow）结束后已自动跑同款全流程；本脚本用于补跑/手工重算。
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { and, eq, like, isNotNull, sql } from 'drizzle-orm';
import { db, salesForecastMonthly, salesForecastVersions } from '@scm/db';
import { applyOptimismDampAfterLanding } from '../server/lib/forecast-optimism-post-landing.js';
import { applyStationSiPortfolioReshape } from '../server/lib/forecast-si-reshape.js';
import {
  applyHorizonDecayAfterReshape,
  applyShadowLandingPipeline,
  promoteForecastFromShadowDaily,
} from '../server/lib/forecast-shadow-landing.js';

const ROOT = resolve(import.meta.dirname, '../../..');
config({ path: resolve(ROOT, '.env') });

const SEASONAL_CALIBRATION_REASON_PREFIX = '类目季节指数校准';

function readArg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

async function promoteMistakenCalibration(versionId: string): Promise<number> {
  const updated = await db
    .update(salesForecastMonthly)
    .set({
      forecastDailyAvg: sql`${salesForecastMonthly.manualDailyAvg}`,
      manualDailyAvg: null,
      adjustReason: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(salesForecastMonthly.versionId, versionId),
        isNotNull(salesForecastMonthly.manualDailyAvg),
        like(salesForecastMonthly.adjustReason, `${SEASONAL_CALIBRATION_REASON_PREFIX}%`),
      ),
    )
    .returning({ id: salesForecastMonthly.id });
  return updated.length;
}

async function main() {
  const versionId = readArg('--version-id');
  if (!versionId) {
    console.error('需要 --version-id');
    process.exit(1);
  }
  const promoteOnly = process.argv.includes('--promote-mistaken-calibration');
  const fromShadow = process.argv.includes('--from-shadow') || !promoteOnly;
  const withReshape =
    process.argv.includes('--with-reshape') || process.argv.includes('--with-horizon-decay');
  const withHorizonDecay = process.argv.includes('--with-horizon-decay') || withReshape;
  const withPostLandingCap =
    !process.argv.includes('--skip-post-landing-cap') &&
    (process.argv.includes('--with-post-landing-cap') || withHorizonDecay || fromShadow);
  const minDiff = Number(readArg('--min-diff') ?? '0.05');
  const useFullPipeline =
    fromShadow && withReshape && withHorizonDecay && !promoteOnly;

  const [version] = await db
    .select({
      versionNo: salesForecastVersions.versionNo,
      status: salesForecastVersions.status,
      startMonth: salesForecastVersions.startMonth,
    })
    .from(salesForecastVersions)
    .where(eq(salesForecastVersions.id, versionId))
    .limit(1);
  if (!version) throw new Error('版本不存在');

  if (promoteOnly || process.argv.includes('--promote-mistaken-calibration')) {
    const promoted = await promoteMistakenCalibration(versionId);
    console.log(`已把季节指数误写入的校准提升为系统值：${promoted} 行（${version.versionNo}）`);
  }

  if (useFullPipeline) {
    const result = await applyShadowLandingPipeline({
      versionId,
      startMonth: version.startMonth,
      minDiff: Number.isFinite(minDiff) ? minDiff : 0.05,
      skipPostLandingCap: !withPostLandingCap,
    });
    console.log(
      `已跑影子落地全流程：promote=${result.promotedRows} reshape=${result.reshapeRows} decay=${result.decayedRows} postCap=${result.postLandingChanged}（${version.versionNo}）`,
    );
    return;
  }

  if (fromShadow && !promoteOnly) {
    const applied = await promoteForecastFromShadowDaily(
      versionId,
      Number.isFinite(minDiff) ? minDiff : 0.05,
    );
    console.log(`已按满幅 shadowDaily 写入系统预测：${applied} 行（${version.versionNo}）`);
  }

  if (withReshape && !promoteOnly) {
    const reshape = await applyStationSiPortfolioReshape({
      versionId,
      startMonth: version.startMonth,
    });
    console.log(
      `已做站点 SI 重塑：groups=${reshape.groupsTouched} rows=${reshape.changedRows} asOf=${reshape.asOfMonth}`,
    );
  }

  if (withHorizonDecay && !promoteOnly) {
    const decayed = await applyHorizonDecayAfterReshape(versionId);
    console.log(`已按地平线衰减写回系统预测：${decayed} 行（${version.versionNo}）`);
  }

  if (withPostLandingCap && !promoteOnly) {
    const post = await applyOptimismDampAfterLanding({ versionId });
    console.log(
      `已做落地后再帽：changed=${post.changedRows} scanned=${post.scannedRows}（${version.versionNo}）`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
