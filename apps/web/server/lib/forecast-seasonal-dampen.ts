/**
 * 季节影子 / SI 重塑的地平线衰减：压远端过冲、减轻近端重塑伤精度。
 */
import {
  loadForecastCalibrationConfig,
  type SeasonalIndexConfig,
} from './forecast-profile-config.js';

/** horizonIndex 0..n → 影子相对原预测增量的保留比例（近端两月满幅，远端轻度衰减） */
export const DEFAULT_SHADOW_HORIZON_DECAY = [1, 1, 0.85, 0.7, 0.6, 0.55] as const;

/** 近端重塑强度（相对 scale−1 的保留比例）；旺季月可走满幅 */
export const DEFAULT_RESHAPE_NEAR_BLEND = 0.5;
export const DEFAULT_RESHAPE_NEAR_MONTHS = 2;
export const DEFAULT_RESHAPE_PEAK_MONTHS = [11, 12] as const;

export type ShadowHorizonDecayConfig = {
  shadowHorizonDecay?: number[];
};

export type ReshapeHorizonDampConfig = {
  reshapeNearHorizonBlend?: number;
  reshapeNearHorizonMonths?: number;
  reshapePeakMonthsFull?: number[];
};

export function resolveShadowHorizonDecay(
  cfg?: SeasonalIndexConfig | null,
): number[] {
  const fromCfg = cfg?.shadowHorizonDecay;
  if (Array.isArray(fromCfg) && fromCfg.length > 0) {
    return fromCfg.map((v) => {
      const n = Number(v);
      if (!Number.isFinite(n)) return 1;
      return Math.min(1, Math.max(0, n));
    });
  }
  return [...DEFAULT_SHADOW_HORIZON_DECAY];
}

export function shadowHorizonDecayAt(
  horizonIndex: number,
  decay = DEFAULT_SHADOW_HORIZON_DECAY as readonly number[],
): number {
  const k = Math.max(0, Math.floor(horizonIndex));
  if (k < decay.length) return decay[k]!;
  return decay[decay.length - 1] ?? 1;
}

/**
 * 将完整影子日均相对 base 的增量按地平线衰减。
 * effective = base + α·(shadow − base)；旺季日历月（默认 11/12）强制 α=1。
 */
export function blendShadowWithHorizonDecay(
  baseDaily: number,
  shadowDaily: number,
  horizonIndex: number,
  decay?: readonly number[],
  options?: { calendarMonth?: number; peakMonths?: readonly number[] },
): number {
  if (!(Number.isFinite(baseDaily) && baseDaily > 0)) return shadowDaily;
  if (!(Number.isFinite(shadowDaily) && shadowDaily > 0)) return baseDaily;
  const peakMonths = options?.peakMonths ?? DEFAULT_RESHAPE_PEAK_MONTHS;
  if (
    options?.calendarMonth != null &&
    peakMonths.includes(options.calendarMonth)
  ) {
    return shadowDaily;
  }
  const alpha = shadowHorizonDecayAt(horizonIndex, decay ?? DEFAULT_SHADOW_HORIZON_DECAY);
  if (alpha >= 0.999) return shadowDaily;
  if (alpha <= 0.001) return baseDaily;
  return baseDaily + alpha * (shadowDaily - baseDaily);
}

export function resolveReshapeHorizonDamp(
  cfg?: SeasonalIndexConfig | null,
): Required<ReshapeHorizonDampConfig> {
  const nearBlend = Number(cfg?.reshapeNearHorizonBlend);
  const nearMonths = Number(cfg?.reshapeNearHorizonMonths);
  const peak = cfg?.reshapePeakMonthsFull;
  return {
    reshapeNearHorizonBlend:
      Number.isFinite(nearBlend) && nearBlend >= 0 && nearBlend <= 1
        ? nearBlend
        : DEFAULT_RESHAPE_NEAR_BLEND,
    reshapeNearHorizonMonths:
      Number.isFinite(nearMonths) && nearMonths >= 0
        ? Math.floor(nearMonths)
        : DEFAULT_RESHAPE_NEAR_MONTHS,
    reshapePeakMonthsFull:
      Array.isArray(peak) && peak.length > 0
        ? peak.map((m) => Number(m)).filter((m) => m >= 1 && m <= 12)
        : [...DEFAULT_RESHAPE_PEAK_MONTHS],
  };
}

/**
 * 近端月份把 scale 向 1 收缩；11/12 等旺季月保持满幅（仍受 clip）。
 */
export function dampenReshapeScale(
  scale: number,
  input: {
    horizonIndex: number;
    calendarMonth: number;
    nearBlend?: number;
    nearMonths?: number;
    peakMonths?: readonly number[];
  },
): number {
  if (!(Number.isFinite(scale) && scale > 0)) return 1;
  const nearBlend = input.nearBlend ?? DEFAULT_RESHAPE_NEAR_BLEND;
  const nearMonths = input.nearMonths ?? DEFAULT_RESHAPE_NEAR_MONTHS;
  const peakMonths = input.peakMonths ?? DEFAULT_RESHAPE_PEAK_MONTHS;
  const h = Math.max(0, Math.floor(input.horizonIndex));
  const isPeak = peakMonths.includes(input.calendarMonth);
  if (isPeak || h >= nearMonths) return scale;
  return 1 + nearBlend * (scale - 1);
}

export function loadSeasonalDampenFromCalibration(): {
  shadowDecay: number[];
  reshape: Required<ReshapeHorizonDampConfig>;
} {
  const cfg = loadForecastCalibrationConfig().seasonalIndex;
  return {
    shadowDecay: resolveShadowHorizonDecay(cfg),
    reshape: resolveReshapeHorizonDamp(cfg),
  };
}

/** 版本内按 (year, month) 排序后的地平线下标。 */
export function buildHorizonIndexByMonthKey(
  months: Array<{ year: number; month: number }>,
): Map<string, number> {
  const keys = [
    ...new Set(
      months.map((item) => `${item.year}-${String(item.month).padStart(2, '0')}`),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return new Map(keys.map((key, index) => [key, index]));
}
