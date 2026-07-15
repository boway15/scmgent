import { and, eq } from 'drizzle-orm';
import { db, forecastAccuracyMonthly, salesForecastReviewItems, skus } from '@scm/db';
import { summarizeAccuracyMatrix } from './forecast-horizon-band.js';
import { getReviewItemStats } from './forecast-review-actions.js';
import type { AccuracyRowInput } from './forecast-accuracy-tier.js';

export type ForecastKpiGatePhase = 'phase0' | 'phase1' | 'phase3';

export type ForecastKpiGateResult = {
  phase: ForecastKpiGatePhase;
  passed: boolean;
  blockers: string[];
  warnings: string[];
  aCorePrecisionWmape: number | null;
  ghostRowPct: number | null;
  top50ReviewedPct: number | null;
};

function resolveGatePhase(): ForecastKpiGatePhase {
  const raw = process.env.FORECAST_KPI_GATE_PHASE?.trim().toLowerCase();
  if (raw === 'phase3' || raw === '3') return 'phase3';
  if (raw === 'phase1' || raw === '1') return 'phase1';
  return 'phase0';
}

export async function evaluateForecastKpiGate(versionId: string): Promise<ForecastKpiGateResult> {
  const phase = resolveGatePhase();
  const blockers: string[] = [];
  const warnings: string[] = [];

  const accuracyRows = await db
    .select({
      skuCode: skus.code,
      actualDailyAvg: forecastAccuracyMonthly.actualDailyAvg,
      forecastDailyAvg: forecastAccuracyMonthly.forecastDailyAvg,
      biasRate: forecastAccuracyMonthly.biasRate,
      mape: forecastAccuracyMonthly.mape,
      forecastYear: forecastAccuracyMonthly.forecastYear,
      month: forecastAccuracyMonthly.month,
    })
    .from(forecastAccuracyMonthly)
    .innerJoin(skus, eq(skus.id, forecastAccuracyMonthly.skuId))
    .where(eq(forecastAccuracyMonthly.versionId, versionId));

  const rows: AccuracyRowInput[] = accuracyRows.map((r) => ({
    skuCode: r.skuCode,
    actualDaily: Number(r.actualDailyAvg),
    forecastDaily: Number(r.forecastDailyAvg),
    mape: r.mape != null ? Number(r.mape) : null,
    biasRate: r.biasRate != null ? Number(r.biasRate) : null,
    forecastYear: r.forecastYear,
    month: r.month,
  }));

  const matrix = summarizeAccuracyMatrix(rows);
  const ghostRows = rows.filter((r) => r.actualDaily === 0 && r.forecastDaily > 0).length;
  const ghostRowPct = rows.length > 0 ? (ghostRows / rows.length) * 100 : null;

  const aCorePrecision = matrix.cells.find(
    (c) => c.segment === 'A:core' && c.band === 'precision',
  );
  const aCorePrecisionWmape = aCorePrecision?.wmape ?? null;

  const reviewStats = await getReviewItemStats(versionId);
  const precisionPending = await db
    .select({ id: salesForecastReviewItems.id })
    .from(salesForecastReviewItems)
    .where(
      and(
        eq(salesForecastReviewItems.versionId, versionId),
        eq(salesForecastReviewItems.issueType, 'precision_review'),
        eq(salesForecastReviewItems.status, 'pending'),
      ),
    );
  const precisionReviewed = await db
    .select({ id: salesForecastReviewItems.id })
    .from(salesForecastReviewItems)
    .where(
      and(
        eq(salesForecastReviewItems.versionId, versionId),
        eq(salesForecastReviewItems.issueType, 'precision_review'),
        eq(salesForecastReviewItems.status, 'reviewed'),
      ),
    );
  const precisionTotal = precisionPending.length + precisionReviewed.length;
  const top50ReviewedPct =
    precisionTotal > 0 ? (precisionReviewed.length / precisionTotal) * 100 : null;

  if (phase === 'phase0') {
    if (ghostRowPct != null && ghostRowPct > 0) {
      blockers.push(`D 类 ghost 行占比 ${ghostRowPct.toFixed(1)}%，目标 0%`);
    }
  }

  if (phase === 'phase1') {
    if (ghostRowPct != null && ghostRowPct > 5) {
      warnings.push(`D 类 ghost 行占比 ${ghostRowPct.toFixed(1)}%，过渡目标 ≤5%`);
    }
    if (aCorePrecisionWmape != null && aCorePrecisionWmape > 0.25) {
      warnings.push(
        `A·常青款·主力 1–3 月 WMAPE ${(aCorePrecisionWmape * 100).toFixed(1)}%（过渡目标 ≤25%）`,
      );
    }
  }

  if (phase === 'phase3') {
    if (ghostRowPct != null && ghostRowPct > 0) {
      blockers.push(`D 类 ghost 行占比 ${ghostRowPct.toFixed(1)}%，目标 0%`);
    }
    const aCoreFlex = matrix.cells.find((c) => c.segment === 'A:core' && c.band === 'flex');
    const kpiPass =
      aCorePrecisionWmape != null &&
      aCorePrecisionWmape <= 0.15 &&
      (aCoreFlex?.wmape == null || aCoreFlex.wmape <= 0.25);
    const reviewPass = top50ReviewedPct != null && top50ReviewedPct >= 100;
    if (!kpiPass && !reviewPass) {
      blockers.push(
        `A·常青款·主力 1–3 月 WMAPE ${aCorePrecisionWmape != null ? `${(aCorePrecisionWmape * 100).toFixed(1)}%` : '—'}（目标 ≤15%），且 Top50 复核未完成`,
      );
    }
    if (reviewStats.pendingBySeverity.critical > 0) {
      blockers.push(`仍有 ${reviewStats.pendingBySeverity.critical} 条 critical 复核待处理`);
    }
    if (precisionPending.length > 0 && !reviewPass) {
      warnings.push(`${precisionPending.length} 条 precision_review 待复核`);
    }
  }

  const adminOverride = process.env.FORECAST_KPI_GATE_OVERRIDE === 'true';
  const passed = blockers.length === 0 || adminOverride;
  if (adminOverride && blockers.length > 0) {
    warnings.push('管理员已启用 FORECAST_KPI_GATE_OVERRIDE');
  }

  return {
    phase,
    passed,
    blockers,
    warnings,
    aCorePrecisionWmape,
    ghostRowPct,
    top50ReviewedPct,
  };
}
