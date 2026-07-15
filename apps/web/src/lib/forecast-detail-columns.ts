/** 预测明细抽屉：按月表列 vs 基线因子区展示规则 */

export type ForecastDetailMonthCell = {
  horizonFactors?: {
    wNear: number;
    wYoy: number;
    nearLevel: number;
    structuralLevel: number;
    growthFactor: number;
    yoyMonthLevel: number;
  } | null;
  allCatV41Factors?: {
    d6: number;
    d3: number;
    trendRatio: number;
    anchorDaily?: number;
    seasonalDaily?: number;
    levelDaily?: number;
    formula: string;
  } | null;
  aiAssistRationale?: string | null;
  aiAssistMode?: 'auto' | 'human' | null;
  forecastModel?: string | null;
};

export type V41AnchoredSnapshot = {
  d6: number;
  d3: number;
  trendRatio: number;
  anchorDaily: number;
  formula: string;
};

export type V41DetailColumnVisibility = {
  d6: boolean;
  trendRatio: boolean;
  anchor: boolean;
  seasonal: boolean;
  blendLevel: boolean;
};

export type LegacyHorizonColumnVisibility = {
  wNear: boolean;
  wYoy: boolean;
  nearLevel: boolean;
  structuralLevel: boolean;
  growthFactor: boolean;
  yoyMonthLevel: boolean;
};

const NUM_EPS = 0.005;

function uniformNumber(
  values: Array<number | null | undefined>,
): number | 'varies' | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (nums.length === 0) return null;
  const first = nums[0]!;
  return nums.every((n) => Math.abs(n - first) <= NUM_EPS) ? first : 'varies';
}

/** V4.1 走步特征：触发时锚定，通常全周期一致 */
export function resolveV41AnchoredSnapshot(
  months: ForecastDetailMonthCell[],
): V41AnchoredSnapshot | null {
  const withV41 = months.filter((cell) => cell.allCatV41Factors);
  if (withV41.length === 0) return null;

  const first = withV41[0]!.allCatV41Factors!;
  const d6 = uniformNumber(withV41.map((c) => c.allCatV41Factors!.d6));
  const d3 = uniformNumber(withV41.map((c) => c.allCatV41Factors!.d3));
  const trendRatio = uniformNumber(withV41.map((c) => c.allCatV41Factors!.trendRatio));
  const anchorDaily = uniformNumber(withV41.map((c) => c.allCatV41Factors!.anchorDaily));

  return {
    d6: d6 === 'varies' ? first.d6 : (d6 ?? first.d6),
    d3: d3 === 'varies' ? first.d3 : (d3 ?? first.d3),
    trendRatio: trendRatio === 'varies' ? first.trendRatio : (trendRatio ?? first.trendRatio),
    anchorDaily:
      anchorDaily === 'varies' ? (first.anchorDaily ?? 0) : (anchorDaily ?? first.anchorDaily ?? 0),
    formula: first.formula,
  };
}

/** 全周期一致的 V4.1 列移入基线因子区，仅按月变化的列留在表中 */
export function resolveV41DetailColumnVisibility(
  months: ForecastDetailMonthCell[],
): V41DetailColumnVisibility {
  const withV41 = months.filter((cell) => cell.allCatV41Factors);
  if (withV41.length === 0) {
    return {
      d6: false,
      trendRatio: false,
      anchor: false,
      seasonal: false,
      blendLevel: false,
    };
  }

  const d6 = uniformNumber(withV41.map((c) => c.allCatV41Factors!.d6));
  const trendRatio = uniformNumber(withV41.map((c) => c.allCatV41Factors!.trendRatio));
  const anchorDaily = uniformNumber(withV41.map((c) => c.allCatV41Factors!.anchorDaily));
  const seasonalDaily = uniformNumber(withV41.map((c) => c.allCatV41Factors!.seasonalDaily));
  const levelDaily = uniformNumber(withV41.map((c) => c.allCatV41Factors!.levelDaily));

  return {
    d6: d6 === 'varies',
    trendRatio: trendRatio === 'varies',
    anchor: anchorDaily === 'varies',
    seasonal: seasonalDaily === 'varies' || seasonalDaily == null,
    blendLevel: levelDaily === 'varies' || levelDaily == null,
  };
}

export function isAiAssistForecastDetail(months: ForecastDetailMonthCell[]): boolean {
  return resolveAiAssistModeFromMonths(months) != null;
}

export function resolveAiAssistModeFromMonths(
  months: ForecastDetailMonthCell[],
): 'auto' | 'human' | null {
  if (months.some((cell) => cell.aiAssistMode === 'human')) return 'human';
  if (
    months.some(
      (cell) => Boolean(cell.aiAssistRationale) || cell.forecastModel === 'dify_single_sku',
    )
  ) {
    return 'auto';
  }
  return null;
}

/** legacy 近端/同比混合列：仅当存在 horizonFactors 时展示（AI 辅助无此数据） */
export function resolveLegacyHorizonColumnVisibility(
  months: ForecastDetailMonthCell[],
): LegacyHorizonColumnVisibility {
  const hasHorizon = months.some((cell) => cell.horizonFactors != null);
  if (!hasHorizon) {
    return {
      wNear: false,
      wYoy: false,
      nearLevel: false,
      structuralLevel: false,
      growthFactor: false,
      yoyMonthLevel: false,
    };
  }

  const cells = months.filter((cell) => cell.horizonFactors);
  const pick = (key: keyof NonNullable<ForecastDetailMonthCell['horizonFactors']>) =>
    cells.some((cell) => {
      const value = cell.horizonFactors![key];
      return value != null && Number.isFinite(value);
    });

  return {
    wNear: pick('wNear'),
    wYoy: pick('wYoy'),
    nearLevel: pick('nearLevel'),
    structuralLevel: pick('structuralLevel'),
    growthFactor: pick('growthFactor'),
    yoyMonthLevel: pick('yoyMonthLevel'),
  };
}

export function hasAnyLegacyHorizonColumn(visibility: LegacyHorizonColumnVisibility): boolean {
  return Object.values(visibility).some(Boolean);
}
