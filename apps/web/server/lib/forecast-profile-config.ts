import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ForecastProfileConfig = {
  continuityMinA: number;
  cvMaxA: number;
  continuityMinB: number;
  cvMaxC: number;
  coreRecent90Min: number;
  coreContinuityMin: number;
  declineRecent30Ratio: number;
};

export type ACoreAlgoConfig = {
  k0Recent30Weight: number;
  k1Recent30Weight: number;
  upperHeadroom: number[];
  declineRecent30Ratio: number;
};

export type FlexBiasShadowTierFactors = Partial<Record<number, number>>;

export type FlexBiasShadowConfig = {
  /** 生产默认开；FORECAST_V41_FLEX_BIAS_CORRECTION=0 可紧急关闭 */
  enabled?: boolean;
  fromK?: number;
  toK?: number;
  minFactor?: number;
  maxFactor?: number;
  tiers?: {
    T4A?: FlexBiasShadowTierFactors;
    T4B?: FlexBiasShadowTierFactors;
    T99?: FlexBiasShadowTierFactors;
  };
};

export type ForecastCalibrationConfig = {
  version: number;
  profile: ForecastProfileConfig;
  aCore: ACoreAlgoConfig;
  flexBiasShadow?: FlexBiasShadowConfig;
};

export const DEFAULT_FORECAST_PROFILE_CONFIG: ForecastProfileConfig = {
  continuityMinA: 0.75,
  cvMaxA: 1.0,
  continuityMinB: 0.75,
  cvMaxC: 1.5,
  coreRecent90Min: 5,
  coreContinuityMin: 0.85,
  declineRecent30Ratio: 0.85,
};

export const DEFAULT_ACORE_ALGO_CONFIG: ACoreAlgoConfig = {
  k0Recent30Weight: 0.7,
  k1Recent30Weight: 0.55,
  upperHeadroom: [1.06, 1.08, 1.1, 1.12, 1.14, 1.16],
  declineRecent30Ratio: 0.85,
};

export const DEFAULT_FORECAST_CALIBRATION_CONFIG: ForecastCalibrationConfig = {
  version: 1,
  profile: DEFAULT_FORECAST_PROFILE_CONFIG,
  aCore: DEFAULT_ACORE_ALGO_CONFIG,
};

function moduleConfigPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '../config/forecast-calibration.json');
}

function mergeProfileConfig(raw: Partial<ForecastProfileConfig> | undefined): ForecastProfileConfig {
  return { ...DEFAULT_FORECAST_PROFILE_CONFIG, ...raw };
}

function mergeACoreConfig(raw: Partial<ACoreAlgoConfig> | undefined): ACoreAlgoConfig {
  const base = { ...DEFAULT_ACORE_ALGO_CONFIG, ...raw };
  if (raw?.upperHeadroom?.length) {
    base.upperHeadroom = [...raw.upperHeadroom];
  }
  return base;
}

function mergeFlexBiasShadowConfig(
  raw: Partial<FlexBiasShadowConfig> | undefined,
): FlexBiasShadowConfig | undefined {
  if (!raw) return undefined;
  return {
    enabled: raw.enabled ?? true,
    fromK: raw.fromK ?? 3,
    toK: raw.toK ?? 5,
    minFactor: raw.minFactor ?? 0.9,
    maxFactor: raw.maxFactor ?? 1.25,
    tiers: raw.tiers,
  };
}

export function parseForecastCalibrationConfig(raw: unknown): ForecastCalibrationConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_FORECAST_CALIBRATION_CONFIG };
  }
  const obj = raw as Partial<ForecastCalibrationConfig>;
  return {
    version: typeof obj.version === 'number' ? obj.version : 1,
    profile: mergeProfileConfig(obj.profile),
    aCore: mergeACoreConfig(obj.aCore),
    flexBiasShadow: mergeFlexBiasShadowConfig(obj.flexBiasShadow),
  };
}

export function loadForecastCalibration(): ForecastCalibrationConfig {
  return loadForecastCalibrationConfig();
}

export function loadForecastCalibrationConfig(): ForecastCalibrationConfig {
  const envPath = process.env.FORECAST_CALIBRATION_PATH?.trim();
  const path = envPath ? resolve(envPath) : moduleConfigPath();
  if (!existsSync(path)) {
    return { ...DEFAULT_FORECAST_CALIBRATION_CONFIG };
  }
  try {
    const text = readFileSync(path, 'utf8');
    return parseForecastCalibrationConfig(JSON.parse(text));
  } catch {
    return { ...DEFAULT_FORECAST_CALIBRATION_CONFIG };
  }
}

export function loadForecastProfileConfig(): ForecastProfileConfig {
  return loadForecastCalibrationConfig().profile;
}

export function loadACoreAlgoConfig(): ACoreAlgoConfig {
  return loadForecastCalibrationConfig().aCore;
}

/** @deprecated 使用 loadForecastCalibrationConfig */
export function loadForecastProfileConfigOnly(): ForecastProfileConfig {
  return loadForecastProfileConfig();
}
