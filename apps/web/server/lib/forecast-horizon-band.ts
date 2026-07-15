import {
  computeMonthlyAvgMape,
  computeMonthlyAvgWmape,
  type AccuracyRowInput,
} from './forecast-accuracy-tier.js';
import { classifyVolumeTier } from './forecast-eligibility.js';
import {
  classifyForecastProfile,
  PROFILE_SEGMENT_META,
  resolveProfileSegment,
  resolveSkuProfileSegment,
  SEGMENT_MATRIX_ROWS,
  type ProfileClass,
  type ProfileSegment,
} from './forecast-profile-class.js';
import {
  formatKpiTargetPct,
  getKpiTarget,
  isKpiMet,
  type HorizonBand,
  type KpiStatus,
} from './forecast-kpi-targets.js';

export type { HorizonBand, KpiStatus } from './forecast-kpi-targets.js';

export const HORIZON_BAND_LABELS: Record<HorizonBand, string> = {
  precision: '1–3 月（精准备货）',
  flex: '3–6 月（生产柔性）',
  strategic: '6–12 月（战略库容）',
};

export const HORIZON_BANDS: HorizonBand[] = ['precision', 'flex', 'strategic'];

export function horizonBandFromIndex(k: number): HorizonBand {
  if (k <= 2) return 'precision';
  if (k <= 5) return 'flex';
  return 'strategic';
}

export function horizonMonthIndex(
  forecastYear: number,
  month: number,
  asOf: Date,
): number {
  const asOfYear = asOf.getUTCFullYear();
  const asOfMonth = asOf.getUTCMonth() + 1;
  return (forecastYear - asOfYear) * 12 + (month - asOfMonth);
}

export type HorizonBandStats = {
  band: HorizonBand;
  label: string;
  skuCount: number;
  comparableRows: number;
  wmape: number | null;
  weightedBias: number | null;
  ghostRowCount: number;
};

export type SegmentBandCell = {
  segment: ProfileSegment;
  segmentLabel: string;
  band: HorizonBand;
  bandLabel: string;
  skuCount: number;
  comparableRows: number;
  wmape: number | null;
  weightedBias: number | null;
  kpiTarget: number | null;
  kpiTargetLabel: string;
  kpiStatus: KpiStatus;
  ghostRowCount: number;
  intervalCoverage: number | null;
};

export type SegmentMatrixSummary = {
  cells: SegmentBandCell[];
  bySegment: SegmentBandStats[];
  byBand: HorizonBandStats[];
};

export type SegmentBandStats = {
  segment: ProfileSegment;
  segmentLabel: string;
  parentClass: ProfileClass;
  measurable: boolean;
  bands: Record<
    HorizonBand,
    {
      skuCount: number;
      comparableRows: number;
      wmape: number | null;
      weightedBias: number | null;
      kpiTarget: number | null;
      kpiStatus: KpiStatus;
      ghostRowCount: number;
    }
  >;
};

export type AccuracyRowWithHorizon = AccuracyRowInput & {
  forecastYear?: number;
  month?: number;
  horizonMonthIndex?: number;
  horizonBand?: HorizonBand;
};

function monthlyMape(rows: AccuracyRowInput[]): number | null {
  return computeMonthlyAvgMape(rows);
}

function attachHorizonBand<T extends AccuracyRowInput>(
  rows: T[],
  asOf?: Date,
): Array<T & { horizonMonthIndex: number; horizonBand: HorizonBand }> {
  const ref = asOf ?? new Date();
  return rows.map((row) => {
    const k =
      row.forecastYear != null && row.month != null
        ? horizonMonthIndex(row.forecastYear, row.month, ref)
        : ((row as AccuracyRowWithHorizon).horizonMonthIndex ?? 0);
    return {
      ...row,
      horizonMonthIndex: k,
      horizonBand: horizonBandFromIndex(k),
    };
  });
}

function buildSegmentBySku(
  rows: AccuracyRowInput[],
  segmentBySku?: Map<string, ProfileSegment>,
): Map<string, ProfileSegment> {
  if (segmentBySku) return segmentBySku;

  const persisted = new Map<string, ProfileSegment>();
  for (const row of rows) {
    if (row.profileSegment) {
      persisted.set(row.skuCode, row.profileSegment as ProfileSegment);
    }
  }
  if (persisted.size > 0) {
    const out = new Map<string, ProfileSegment>();
    for (const row of rows) {
      out.set(row.skuCode, persisted.get(row.skuCode) ?? 'A:mid');
    }
    return out;
  }

  const bySku = new Map<string, AccuracyRowInput[]>();
  for (const row of rows) {
    const list = bySku.get(row.skuCode) ?? [];
    list.push(row);
    bySku.set(row.skuCode, list);
  }

  const out = new Map<string, ProfileSegment>();
  for (const [skuCode, skuRows] of bySku) {
    const monthlyQty = skuRows.map((r) => r.actualDaily);
    const avgDaily =
      monthlyQty.length > 0
        ? monthlyQty.reduce((s, x) => s + x, 0) / monthlyQty.length
        : 0;
    const profileClass = classifyForecastProfile(monthlyQty);
    const volumeTier = classifyVolumeTier(avgDaily);
    const hasActual = monthlyQty.some((q) => q > 0);
    const skipped = !hasActual && profileClass === 'D';
    out.set(
      skuCode,
      resolveProfileSegment(profileClass, {
        volumeTier,
        layer: profileClass === 'C' ? 'sku' : undefined,
        skipped,
      }),
    );
  }
  return out;
}

export function summarizeAccuracyByHorizonBand(
  rows: AccuracyRowInput[],
  asOf?: Date,
): HorizonBandStats[] {
  const enriched = attachHorizonBand(rows, asOf);
  return HORIZON_BANDS.map((band) => {
    const sub = enriched.filter((r) => r.horizonBand === band);
    const comparable = sub.filter((r) => r.actualDaily > 0);
    const skuSet = new Set(sub.map((r) => r.skuCode));
    return {
      band,
      label: HORIZON_BAND_LABELS[band],
      skuCount: skuSet.size,
      comparableRows: comparable.length,
      wmape: computeMonthlyAvgWmape(sub),
      weightedBias: monthlyMape(sub),
      ghostRowCount: sub.filter((r) => r.actualDaily === 0 && r.forecastDaily > 0).length,
    };
  });
}

export function summarizeAccuracyBySegment(
  rows: AccuracyRowInput[],
  opts?: {
    asOf?: Date;
    segmentBySku?: Map<string, ProfileSegment>;
  },
): SegmentBandStats[] {
  const enriched = attachHorizonBand(rows, opts?.asOf);
  const segmentMap = buildSegmentBySku(rows, opts?.segmentBySku);

  return SEGMENT_MATRIX_ROWS.map((segment) => {
    const meta = PROFILE_SEGMENT_META[segment];
    const bands = {} as SegmentBandStats['bands'];
    for (const band of HORIZON_BANDS) {
      const sub = enriched.filter(
        (r) => segmentMap.get(r.skuCode) === segment && r.horizonBand === band,
      );
      const comparable = sub.filter((r) => r.actualDaily > 0);
      const wmape = computeMonthlyAvgWmape(sub);
      const kpiTarget = getKpiTarget(segment, band);
      bands[band] = {
        skuCount: new Set(sub.map((r) => r.skuCode)).size,
        comparableRows: comparable.length,
        wmape,
        weightedBias: monthlyMape(sub),
        kpiTarget,
        kpiStatus: isKpiMet(segment, band, wmape, meta.measurable),
        ghostRowCount: sub.filter((r) => r.actualDaily === 0 && r.forecastDaily > 0).length,
      };
    }
    return {
      segment,
      segmentLabel: meta.label,
      parentClass: meta.parentClass,
      measurable: meta.measurable,
      bands,
    };
  });
}

function intervalCoverage(rows: AccuracyRowInput[]): number | null {
  const withBands = rows.filter(
    (r) =>
      r.actualDaily > 0 &&
      r.forecastDailyP10 != null &&
      r.forecastDailyP90 != null &&
      r.forecastDailyP90 > 0,
  );
  if (!withBands.length) return null;
  const covered = withBands.filter(
    (r) => r.actualDaily >= (r.forecastDailyP10 ?? 0) && r.actualDaily <= (r.forecastDailyP90 ?? 0),
  );
  return covered.length / withBands.length;
}

export function summarizeAccuracyMatrix(
  rows: AccuracyRowInput[],
  opts?: {
    asOf?: Date;
    segmentBySku?: Map<string, ProfileSegment>;
  },
): SegmentMatrixSummary {
  const enriched = attachHorizonBand(rows, opts?.asOf);
  const segmentMap = buildSegmentBySku(rows, opts?.segmentBySku);
  const bySegment = summarizeAccuracyBySegment(rows, opts);
  const cells: SegmentBandCell[] = [];
  for (const seg of bySegment) {
    for (const band of HORIZON_BANDS) {
      const b = seg.bands[band];
      const bandRows = enriched.filter(
        (r) => segmentMap.get(r.skuCode) === seg.segment && r.horizonBand === band,
      );
      cells.push({
        segment: seg.segment,
        segmentLabel: seg.segmentLabel,
        band,
        bandLabel: HORIZON_BAND_LABELS[band],
        skuCount: b.skuCount,
        comparableRows: b.comparableRows,
        wmape: b.wmape,
        weightedBias: b.weightedBias,
        kpiTarget: b.kpiTarget,
        kpiTargetLabel: formatKpiTargetPct(b.kpiTarget),
        kpiStatus: b.kpiStatus,
        ghostRowCount: b.ghostRowCount,
        intervalCoverage: seg.parentClass === 'B' ? intervalCoverage(bandRows) : null,
      });
    }
  }
  return {
    cells,
    bySegment,
    byBand: summarizeAccuracyByHorizonBand(rows, opts?.asOf),
  };
}

export { resolveSkuProfileSegment };
