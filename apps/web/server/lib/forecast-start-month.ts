/** 生成预测可选开始月：当月 + 往前 N 个月（严格回测） */

export const FORECAST_START_MONTH_LOOKBACK = 6;

const YEAR_MONTH_RE = /^(\d{4})-(\d{2})$/;

export function formatForecastStartMonth(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function buildForecastStartMonthOptions(
  now = new Date(),
  lookback = FORECAST_START_MONTH_LOOKBACK,
): string[] {
  const options: string[] = [];
  const year = now.getUTCFullYear();
  const monthIndex = now.getUTCMonth();
  for (let offset = 0; offset <= lookback; offset++) {
    const date = new Date(Date.UTC(year, monthIndex - offset, 1));
    options.push(formatForecastStartMonth(date));
  }
  return options;
}

export function resolveForecastStartMonthAsOf(startMonth: string): Date {
  const match = YEAR_MONTH_RE.exec(startMonth.trim());
  if (!match) {
    throw new Error('startMonth 须为 YYYY-MM 格式');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('startMonth 须为 YYYY-MM 格式');
  }
  return new Date(Date.UTC(year, month - 1, 1));
}

export function isForecastStartMonthBacktest(startMonth: string, now = new Date()): boolean {
  return startMonth < formatForecastStartMonth(now);
}

export function parseAndValidateForecastStartMonth(
  raw: string | undefined | null,
  now = new Date(),
): { startMonth: string; isBacktest: boolean; asOf: Date } {
  const trimmed = raw?.trim();
  const startMonth = trimmed ? trimmed : formatForecastStartMonth(now);

  if (!YEAR_MONTH_RE.test(startMonth)) {
    throw new Error('startMonth 须为 YYYY-MM 格式');
  }

  const allowed = new Set(buildForecastStartMonthOptions(now));
  if (!allowed.has(startMonth)) {
    throw new Error(
      `startMonth 仅支持当月及往前 ${FORECAST_START_MONTH_LOOKBACK} 个月（当前可选 ${formatForecastStartMonth(now)} ~ ${buildForecastStartMonthOptions(now).at(-1)}）`,
    );
  }

  const asOf = resolveForecastStartMonthAsOf(startMonth);
  return {
    startMonth,
    isBacktest: isForecastStartMonthBacktest(startMonth, now),
    asOf,
  };
}

/** 生成链路：startMonth 优先；兼容 Date / ISO 字符串 today */
export function resolveBaselineGenerationAsOf(input: {
  startMonth?: string | null;
  today?: Date | string | null;
  now?: Date;
}): { startMonth: string; asOf: Date } {
  const trimmed = input.startMonth?.trim();
  if (trimmed) {
    const asOf = resolveForecastStartMonthAsOf(trimmed);
    return { startMonth: formatForecastStartMonth(asOf), asOf };
  }

  if (input.today instanceof Date && !Number.isNaN(input.today.getTime())) {
    const asOf = new Date(Date.UTC(input.today.getUTCFullYear(), input.today.getUTCMonth(), 1));
    return { startMonth: formatForecastStartMonth(asOf), asOf };
  }

  if (typeof input.today === 'string' && input.today.trim()) {
    const parsed = new Date(input.today);
    if (!Number.isNaN(parsed.getTime())) {
      const asOf = new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), 1));
      return { startMonth: formatForecastStartMonth(asOf), asOf };
    }
  }

  const asOf = new Date(
    Date.UTC((input.now ?? new Date()).getUTCFullYear(), (input.now ?? new Date()).getUTCMonth(), 1),
  );
  return { startMonth: formatForecastStartMonth(asOf), asOf };
}
