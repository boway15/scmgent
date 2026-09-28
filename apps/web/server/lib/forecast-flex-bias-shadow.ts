import { roundDaily } from './forecast-baseline.js';
import type { AllCatV41Tier } from './forecast-allcat-v41.js';
import {
  loadForecastCalibrationConfig,
  type FlexBiasShadowConfig,
} from './forecast-profile-config.js';

/** 显式开启（走步对照）；生产默认读 calibration.enabled */
export const FLEX_BIAS_SHADOW_ENV = 'FORECAST_V41_FLEX_BIAS_SHADOW';
/** 设为 0/false/off 可紧急关闭生产校正 */
export const FLEX_BIAS_CORRECTION_DISABLE_ENV = 'FORECAST_V41_FLEX_BIAS_CORRECTION';

export const FLEX_BIAS_CORRECTION_VERSION = 'v2_2026-09';

/** 柔性窗偏差校正默认系数（k=3/4/5）；走步 v2 验收：柔性窗 -13.1% → -8.2% */
export const DEFAULT_FLEX_BIAS_SHADOW_FACTORS: Record<'T4A' | 'T4B' | 'T99', Record<number, number>> = {
  T4A: { 3: 1.45, 4: 1.55, 5: 1.65 },
  T4B: { 3: 1.35, 4: 1.45, 5: 1.55 },
  T99: { 3: 1.4, 4: 1.5, 5: 1.6 },
};

export const FLEX_BIAS_SHADOW_TIERS = new Set<AllCatV41Tier>(['T4A', 'T4B', 'T99']);

export type FlexBiasShadowApplyResult = {
  forecastDaily: number;
  applied: boolean;
  correctionFactor: number | null;
  preFlexBiasDaily: number | null;
};

function parseTruthy(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function resolveFlexBiasShadowConfig(): FlexBiasShadowConfig {
  const calibration = loadForecastCalibrationConfig();
  return calibration.flexBiasShadow ?? {
    enabled: true,
    fromK: 3,
    toK: 5,
    minFactor: 0.9,
    maxFactor: 1.7,
    tiers: DEFAULT_FLEX_BIAS_SHADOW_FACTORS,
  };
}

function parseFalsey(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off';
}

/** 显式 override > 紧急关闭 env > calibration.enabled */
export function resolveFlexBiasShadowEnabled(override?: boolean | null): boolean {
  if (override != null) return override;
  if (parseFalsey(process.env[FLEX_BIAS_CORRECTION_DISABLE_ENV])) return false;
  if (parseTruthy(process.env[FLEX_BIAS_SHADOW_ENV])) return true;
  return resolveFlexBiasShadowConfig().enabled === true;
}

export function resolveFlexBiasCorrectionFactor(input: {
  tier: AllCatV41Tier;
  horizonIndex: number;
  config?: FlexBiasShadowConfig;
}): number | null {
  if (!FLEX_BIAS_SHADOW_TIERS.has(input.tier)) return null;
  const config = input.config ?? resolveFlexBiasShadowConfig();
  const k = Math.max(0, Math.floor(input.horizonIndex));
  if (k < config.fromK || k > config.toK) return null;

  const tierFactors = config.tiers?.[input.tier as keyof NonNullable<FlexBiasShadowConfig['tiers']>];
  const raw = tierFactors?.[k];
  if (raw == null || !Number.isFinite(raw) || raw <= 0) return null;

  const minFactor = config.minFactor ?? 0.9;
  const maxFactor = config.maxFactor ?? 1.7;
  return Math.min(maxFactor, Math.max(minFactor, raw));
}

export function applyFlexBiasShadowCorrection(input: {
  tier: AllCatV41Tier;
  horizonIndex: number;
  forecastDaily: number;
  flexBiasShadow?: boolean | null;
  config?: FlexBiasShadowConfig;
}): FlexBiasShadowApplyResult {
  const preFlexBiasDaily = input.forecastDaily;
  if (input.forecastDaily <= 0) {
    return {
      forecastDaily: input.forecastDaily,
      applied: false,
      correctionFactor: null,
      preFlexBiasDaily: null,
    };
  }

  const enabled = resolveFlexBiasShadowEnabled(input.flexBiasShadow);
  const correctionFactor = enabled
    ? resolveFlexBiasCorrectionFactor({
        tier: input.tier,
        horizonIndex: input.horizonIndex,
        config: input.config,
      })
    : null;

  if (!enabled || correctionFactor == null || correctionFactor === 1) {
    return {
      forecastDaily: input.forecastDaily,
      applied: false,
      correctionFactor: correctionFactor === 1 ? null : correctionFactor,
      preFlexBiasDaily: null,
    };
  }

  return {
    forecastDaily: roundDaily(input.forecastDaily * correctionFactor),
    applied: true,
    correctionFactor,
    preFlexBiasDaily: roundDaily(preFlexBiasDaily),
  };
}

export function mergeFlexBiasShadowHorizonFactors(
  horizonFactors: Record<string, unknown>,
  shadow: FlexBiasShadowApplyResult,
): void {
  if (!shadow.applied || shadow.correctionFactor == null || shadow.preFlexBiasDaily == null) {
    return;
  }
  horizonFactors.flexBiasCorrectionApplied = true;
  horizonFactors.flexBiasCorrectionVersion = FLEX_BIAS_CORRECTION_VERSION;
  horizonFactors.flexBiasCorrection = shadow.correctionFactor;
  horizonFactors.forecastDailyPreFlexBias = shadow.preFlexBiasDaily;
  /** @deprecated 兼容旧诊断脚本 */
  horizonFactors.flexBiasShadow = true;
  horizonFactors.flexBiasShadowMode = FLEX_BIAS_CORRECTION_VERSION;
}
