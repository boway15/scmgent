/** 生成周计划可选开始周：含当周 + 往前 N 周（严格回测） */

import {
  addIsoWeeks,
  isoWeekKeyFromUtcDate,
  isoWeekMondayUtc,
  planningAssumedSalesCutoff,
  planningRecentWindowEnd,
} from './planning-calendar.js';

export const DEMAND_PLAN_START_WEEK_LOOKBACK = 26;

const ISO_WEEK_RE = /^(\d{4})-W(\d{2})$/;

export function isDemandPlanIsoWeekKey(value: string): boolean {
  return ISO_WEEK_RE.test(value.trim());
}

export function buildDemandPlanStartWeekOptions(
  now = new Date(),
  lookback = DEMAND_PLAN_START_WEEK_LOOKBACK,
): string[] {
  const current = isoWeekKeyFromUtcDate(now);
  const options: string[] = [];
  for (let offset = 0; offset <= lookback; offset += 1) {
    options.push(addIsoWeeks(current, -offset));
  }
  return options;
}

export function isDemandPlanStartWeekBacktest(startWeek: string, now = new Date()): boolean {
  return startWeek.trim() < isoWeekKeyFromUtcDate(now);
}

/** 严格回测：训练窗口截止于开始周周一之前（上一周周日） */
export function planningTrainingWindowEndBeforeWeek(startWeek: string): Date {
  const monday = isoWeekMondayUtc(startWeek.trim());
  const end = new Date(monday.getTime());
  end.setUTCDate(end.getUTCDate() - 1);
  return end;
}

export function parseAndValidateDemandPlanStartWeek(
  raw: string | undefined | null,
  now = new Date(),
): { startWeek: string; isBacktest: boolean; anchorMonday: Date } {
  const trimmed = raw?.trim();
  const startWeek = trimmed || isoWeekKeyFromUtcDate(now);

  if (!isDemandPlanIsoWeekKey(startWeek)) {
    throw new Error('startWeek 须为 YYYY-Www 格式（ISO 周）');
  }

  const allowed = new Set(buildDemandPlanStartWeekOptions(now));
  if (!allowed.has(startWeek)) {
    throw new Error(
      `startWeek 仅支持当周及往前 ${DEMAND_PLAN_START_WEEK_LOOKBACK} 周（当前可选 ${isoWeekKeyFromUtcDate(now)} ~ ${buildDemandPlanStartWeekOptions(now).at(-1)}）`,
    );
  }

  return {
    startWeek,
    isBacktest: isDemandPlanStartWeekBacktest(startWeek, now),
    anchorMonday: isoWeekMondayUtc(startWeek),
  };
}

export function buildDemandPlanWeekHorizon(startWeek: string, count: number): string[] {
  const safeCount = Math.max(0, Math.floor(count));
  return Array.from({ length: safeCount }, (_, index) => addIsoWeeks(startWeek, index));
}

/**
 * SKU 详情训练近窗：与 generateDemandPlanDraft 一致，回测时截止开始周前一日。
 * 仅用于 inline V4.1 / 近端水位等生成口径，不用于计划周实销对照。
 */
export function resolveDemandPlanSkuDetailSalesWindow(input: {
  startWeek: string | null | undefined;
  now?: Date;
  maxSaleDate?: string | null;
}): {
  startWeek: string;
  isBacktest: boolean;
  windowEnd: Date;
} {
  const now = input.now ?? new Date();
  const startWeek = input.startWeek?.trim() || isoWeekKeyFromUtcDate(now);
  const isBacktest = isDemandPlanStartWeekBacktest(startWeek, now);
  const strictTrainingEnd = isBacktest ? planningTrainingWindowEndBeforeWeek(startWeek) : null;

  let windowEnd: Date;
  if (isBacktest) {
    windowEnd = strictTrainingEnd!;
    if (input.maxSaleDate) {
      const strictKey = windowEnd.toISOString().slice(0, 10);
      if (input.maxSaleDate < strictKey) {
        const [y, m, d] = input.maxSaleDate.split('-').map(Number);
        windowEnd = new Date(Date.UTC(y!, m! - 1, d!));
      }
    }
  } else {
    windowEnd = planningRecentWindowEnd(now, {
      maxSaleDate: input.maxSaleDate ?? undefined,
    });
  }

  return { startWeek, isBacktest, windowEnd };
}

export function resolveDemandPlanSkuDetailAssumedSalesEnd(input: {
  startWeek: string | null | undefined;
  now?: Date;
}): Date {
  const now = input.now ?? new Date();
  const startWeek = input.startWeek?.trim() || isoWeekKeyFromUtcDate(now);
  const isBacktest = isDemandPlanStartWeekBacktest(startWeek, now);
  return isBacktest
    ? planningTrainingWindowEndBeforeWeek(startWeek)
    : planningAssumedSalesCutoff(now);
}

/** 计划周 / 历史区实销展示：与准确度导出一致（业务日 − lag、且不超过库内最大销日） */
export function resolveDemandPlanSkuDetailActualDisplayWindow(input: {
  now?: Date;
  maxSaleDate?: string | null;
}): Date {
  return planningRecentWindowEnd(input.now ?? new Date(), {
    maxSaleDate: input.maxSaleDate ?? undefined,
  });
}
