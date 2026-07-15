/**
 * AI+人工辅助：外生因素入参（仅传 Dify，不写 forecast_exogenous_flags）
 */

export const FORECAST_EXOGENOUS_REASONS = [
  'price_change',
  'ad',
  'promo',
  'listing_change',
  'other',
] as const;

export type ForecastExogenousReason = (typeof FORECAST_EXOGENOUS_REASONS)[number];

export type ForecastExogenousFactor = {
  monthLabel: string;
  reason: ForecastExogenousReason;
  /** 调价：百分比变化（-10=降价10%）；广告：强度倍数（1.5=加投50%） */
  intensity?: number;
  note?: string;
};

export type ForecastExogenousInput = {
  factors: ForecastExogenousFactor[];
  operatorNote?: string;
};

export type ForecastAssistMode = 'auto' | 'human';

function isExogenousReason(value: unknown): value is ForecastExogenousReason {
  return typeof value === 'string' && (FORECAST_EXOGENOUS_REASONS as readonly string[]).includes(value);
}

function validationError(message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = 400;
  return err;
}

export function normalizeForecastExogenousInput(raw: unknown): ForecastExogenousInput | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'object') {
    throw validationError('exogenousFactors must be an object');
  }
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.factors)) {
    throw validationError('exogenousFactors.factors must be an array');
  }

  const factors: ForecastExogenousFactor[] = [];
  for (const item of value.factors) {
    if (!item || typeof item !== 'object') {
      throw validationError('Each exogenous factor must be an object');
    }
    const row = item as Record<string, unknown>;
    const monthLabel = String(row.monthLabel ?? '').trim();
    if (!monthLabel) {
      throw validationError('exogenous factor monthLabel is required');
    }
    if (!isExogenousReason(row.reason)) {
      throw validationError(`Invalid exogenous reason: ${String(row.reason)}`);
    }
    let intensity: number | undefined;
    if (row.intensity != null && row.intensity !== '') {
      intensity = Number(row.intensity);
      if (!Number.isFinite(intensity)) {
        throw validationError(`Invalid intensity for month ${monthLabel}`);
      }
    }
    const note = row.note != null ? String(row.note).trim() : undefined;
    factors.push({
      monthLabel,
      reason: row.reason,
      intensity,
      note: note || undefined,
    });
  }

  const operatorNote =
    value.operatorNote != null ? String(value.operatorNote).trim() || undefined : undefined;

  return { factors, operatorNote };
}

export function validateExogenousAgainstHorizon(
  exogenous: ForecastExogenousInput | undefined,
  allowedMonthLabels: Set<string>,
): void {
  if (!exogenous?.factors.length) return;
  for (const factor of exogenous.factors) {
    if (!allowedMonthLabels.has(factor.monthLabel)) {
      throw validationError(`外生因素月份 ${factor.monthLabel} 不在预测周期内`);
    }
  }
}

export function validateHumanAssistInput(input: {
  assistMode?: ForecastAssistMode;
  exogenousFactors?: ForecastExogenousInput;
}): ForecastExogenousInput | undefined {
  const assistMode = input.assistMode ?? 'auto';
  if (assistMode !== 'auto' && assistMode !== 'human') {
    throw validationError('assistMode must be auto or human');
  }

  const exogenous = input.exogenousFactors;
  if (assistMode === 'human') {
    const hasFactors = (exogenous?.factors.length ?? 0) > 0;
    const hasNote = Boolean(exogenous?.operatorNote?.trim());
    if (!hasFactors && !hasNote) {
      throw validationError('AI+人工模式需至少填写一条外生因素或运营补充说明');
    }
  }

  return exogenous;
}

export function serializeExogenousJson(exogenous?: ForecastExogenousInput): string {
  return JSON.stringify(exogenous ?? { factors: [], operatorNote: '' });
}

export function buildAiAssistHorizonFactors(input: {
  assistMode: ForecastAssistMode;
  exogenous?: ForecastExogenousInput;
  tier: string;
  reviewTier: string | null;
  rationale?: string;
  confidence?: string;
}): Record<string, unknown> {
  return {
    source: 'ai_assist',
    assistMode: input.assistMode,
    exogenous: input.exogenous ?? null,
    tier: input.tier,
    tierSystem: input.reviewTier === 'T99' ? 'AllCategory-KPI-CoreFirst-T99-V41' : 'AI-Single-SKU',
    rationale: input.rationale,
    confidence: input.confidence,
  };
}
