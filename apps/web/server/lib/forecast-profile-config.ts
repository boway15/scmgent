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

export type SeasonalIndexMode = 'off' | 'shadow' | 'on';

export type SeasonalIndexConfig = {
  /** shadow 只写对照值；on 才改变预测。FORECAST_V41_SEASONAL_INDEX 可覆盖。 */
  mode?: SeasonalIndexMode;
  /** 类目向项目组、项目组向站点收缩的样本量常数 */
  k?: number;
  clipMin?: number;
  clipMax?: number;
  minAgeMonths?: number;
  forwardMonths?: number;
  /**
   * 生成结束后按站点 SI 重塑项目组×月的系统日均形状（抬旺季、压淡季）。
   * 默认：mode≠off 时开启。false 可关掉。
   */
  reshapePortfolio?: boolean;
  /**
   * 影子相对原预测增量的地平线衰减（按 horizonIndex 取下标，超出用末项）。
   * 用于落地系统日均 / mode=on，不改写 shadowDaily 原始对照值。
   */
  shadowHorizonDecay?: number[];
  /** 近端重塑强度（0~1），对 scale−1 的保留比例；默认 0.5 */
  reshapeNearHorizonBlend?: number;
  /** 视为近端的月数（horizonIndex < 该值时衰减）；默认 2 */
  reshapeNearHorizonMonths?: number;
  /** 满幅重塑的日历月（默认 11/12），不受近端衰减 */
  reshapePeakMonthsFull?: number[];
};

export type ForecastCalibrationConfig = {
  version: number;
  profile: ForecastProfileConfig;
  aCore: ACoreAlgoConfig;
  flexBiasShadow?: FlexBiasShadowConfig;
  seasonalIndex?: SeasonalIndexConfig;
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

export const DEFAULT_SEASONAL_INDEX_CONFIG: SeasonalIndexConfig = {
  mode: 'shadow',
  k: 20000,
  clipMin: 0.6,
  clipMax: 1.8,
  minAgeMonths: 3,
  forwardMonths: 2,
  reshapePortfolio: true,
  shadowHorizonDecay: [1, 1, 0.85, 0.7, 0.6, 0.55],
  reshapeNearHorizonBlend: 0.5,
  reshapeNearHorizonMonths: 2,
  reshapePeakMonthsFull: [11, 12],
};

export const DEFAULT_FORECAST_CALIBRATION_CONFIG: ForecastCalibrationConfig = {
  version: 1,
  profile: DEFAULT_FORECAST_PROFILE_CONFIG,
  aCore: DEFAULT_ACORE_ALGO_CONFIG,
  seasonalIndex: DEFAULT_SEASONAL_INDEX_CONFIG,
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

function mergeSeasonalIndexConfig(
  raw: Partial<SeasonalIndexConfig> | undefined,
): SeasonalIndexConfig {
  const mode = raw?.mode === 'off' || raw?.mode === 'on' || raw?.mode === 'shadow' ? raw.mode : 'shadow';
  return {
    ...DEFAULT_SEASONAL_INDEX_CONFIG,
    ...raw,
    mode,
  };
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
    seasonalIndex: mergeSeasonalIndexConfig(obj.seasonalIndex),
  };
}

export const SEASONAL_INDEX_MODE_ENV = 'FORECAST_V41_SEASONAL_INDEX';

/** 显式 override > 环境变量 > forecast-calibration.json。默认 shadow。 */
export function resolveSeasonalIndexMode(override?: SeasonalIndexMode | null): SeasonalIndexMode {
  if (override === 'off' || override === 'shadow' || override === 'on') return override;
  const env = process.env[SEASONAL_INDEX_MODE_ENV]?.trim().toLowerCase();
  if (env === 'off' || env === '0' || env === 'false' || env === 'no') return 'off';
  if (env === 'on' || env === '1' || env === 'true') return 'on';
  if (env === 'shadow') return 'shadow';
  return loadForecastCalibrationConfig().seasonalIndex?.mode ?? 'shadow';
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
