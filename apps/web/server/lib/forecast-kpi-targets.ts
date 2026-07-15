import type { ProfileSegment } from './forecast-profile-class.js';

export type HorizonBand = 'precision' | 'flex' | 'strategic';
export type KpiStatus = 'pass' | 'warn' | 'fail' | 'na' | 'display_only';

/** WMAPE 目标：segment:band => max WMAPE (0-1) */
export const KPI_TARGETS: Partial<Record<string, number>> = {
  'A:core:precision': 0.15,
  'A:core:flex': 0.25,
  'A:core:strategic': 0.35,
  'A:mid:precision': 0.2,
  'A:mid:flex': 0.3,
  'A:mid:strategic': 0.4,
  'A:tail:precision': 0.25,
  'A:tail:flex': 0.35,
  'A:tail:strategic': 0.45,
  'B:core:precision': 0.2,
  'B:core:flex': 0.25,
  'B:core:strategic': 0.4,
  'B:mid:precision': 0.22,
  'B:mid:flex': 0.28,
  'B:mid:strategic': 0.4,
  'B:tail:precision': 0.25,
  'B:tail:flex': 0.3,
  'B:tail:strategic': 0.4,
  'C:pool:precision': 0.2,
  'C:pool:flex': 0.25,
  'C:pool:strategic': 0.35,
};

export const INTERVAL_COVERAGE_TARGETS: Partial<Record<string, number>> = {
  'B:core:precision': 0.7,
  'B:core:flex': 0.7,
  'B:mid:precision': 0.65,
  'B:mid:flex': 0.65,
  'B:tail:precision': 0.6,
  'B:tail:flex': 0.6,
};

export function segmentMatrixKey(segment: ProfileSegment, band: HorizonBand): string {
  return `${segment}:${band}`;
}

export function getKpiTarget(segment: ProfileSegment, band: HorizonBand): number | null {
  return KPI_TARGETS[segmentMatrixKey(segment, band)] ?? null;
}

export function isKpiMet(
  segment: ProfileSegment,
  band: HorizonBand,
  wmape: number | null,
  measurable = true,
): KpiStatus {
  if (!measurable) return 'display_only';
  const target = getKpiTarget(segment, band);
  if (target == null) {
    if (segment.startsWith('D:')) return 'na';
    if (segment.startsWith('C:sku')) return 'display_only';
    return 'na';
  }
  if (wmape == null) return 'na';
  if (wmape <= target) return 'pass';
  if (wmape <= target * 1.15) return 'warn';
  return 'fail';
}

export function formatKpiTargetPct(target: number | null): string {
  if (target == null) return '—';
  return `≤${(target * 100).toFixed(0)}%`;
}
