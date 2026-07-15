import {
  formatForecastMonth,
  aggregateForecastRows,
  type MonthlyForecastRow,
} from './forecast-demand.js';
import { DEFAULT_PRODUCTION_LEAD_DAYS, DEFAULT_INBOUND_BUFFER_DAYS } from './replenishment-coverage.js';

export type ForecastValidationIssue = {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  skuCode?: string;
  station?: string;
  platform?: string;
  forecastMonth?: string;
};

export type ForecastRowInput = {
  skuId: string;
  skuCode: string;
  station: string;
  platform: string;
  forecastYear: number;
  month: number;
  forecastDailyAvg: number;
};

const MAX_LEAD_DAYS = DEFAULT_PRODUCTION_LEAD_DAYS + 80 + DEFAULT_INBOUND_BUFFER_DAYS + 30;

export function validateForecastRows(rows: ForecastRowInput[]): ForecastValidationIssue[] {
  const issues: ForecastValidationIssue[] = [];
  if (rows.length === 0) {
    issues.push({
      level: 'error',
      code: 'forecast_empty',
      message: '预测版本没有明细，不能发布',
    });
    return issues;
  }

  const bySkuStationMonth = new Map<string, ForecastRowInput[]>();

  for (const row of rows) {
    if (!Number.isFinite(row.forecastDailyAvg) || row.forecastDailyAvg < 0) {
      issues.push({
        level: 'error',
        code: 'invalid_forecast_daily_avg',
        message: '预测日均必须为大于等于 0 的有限数字',
        skuCode: row.skuCode,
        station: row.station,
        platform: row.platform,
        forecastMonth: formatForecastMonth(row.forecastYear, row.month),
      });
    }

    const key = `${row.skuId}::${row.station}::${formatForecastMonth(row.forecastYear, row.month)}`;
    const list = bySkuStationMonth.get(key) ?? [];
    list.push(row);
    bySkuStationMonth.set(key, list);
  }

  for (const group of bySkuStationMonth.values()) {
    const hasAll = group.some((r) => r.platform === 'ALL');
    const hasSpecific = group.some((r) => r.platform !== 'ALL');
    if (hasAll && hasSpecific) {
      const sample = group[0];
      issues.push({
        level: 'warning',
        code: 'platform_mix_all_and_specific',
        message: '同 SKU+站点+月份同时存在 ALL 与分平台预测，补货仅使用分平台汇总',
        skuCode: sample.skuCode,
        station: sample.station,
        forecastMonth: formatForecastMonth(sample.forecastYear, sample.month),
      });
    }
  }

  const today = new Date();
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + MAX_LEAD_DAYS);

  const skuStationKeys = new Set(rows.map((r) => `${r.skuId}::${r.station}`));
  for (const skuStation of skuStationKeys) {
    const [skuId, station] = skuStation.split('::');
    const subset = rows.filter((r) => r.skuId === skuId && r.station === station);
    const map = aggregateForecastRows(
      subset.map(
        (r): MonthlyForecastRow & { platform?: string } => ({
          forecastYear: r.forecastYear,
          month: r.month,
          forecastDailyAvg: r.forecastDailyAvg,
          platform: r.platform,
        }),
      ),
    );

    const cursor = new Date(today.getFullYear(), today.getMonth(), 1);
    while (cursor <= horizon) {
      const monthKey = formatForecastMonth(cursor.getFullYear(), cursor.getMonth() + 1);
      if (!map.has(monthKey) || (map.get(monthKey) ?? 0) <= 0) {
        issues.push({
          level: 'warning',
          code: 'coverage_gap',
          message: `未来补货窗口内缺少预测: ${monthKey}`,
          skuCode: subset[0]?.skuCode,
          station,
          forecastMonth: monthKey,
        });
        break;
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  const sorted = [...rows].sort((a, b) => {
    if (a.skuId !== b.skuId) return a.skuId.localeCompare(b.skuId);
    if (a.station !== b.station) return a.station.localeCompare(b.station);
    if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);
    if (a.forecastYear !== b.forecastYear) return a.forecastYear - b.forecastYear;
    return a.month - b.month;
  });

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (
      prev.skuId === curr.skuId &&
      prev.station === curr.station &&
      prev.platform === curr.platform &&
      prev.forecastDailyAvg > 0
    ) {
      const change = Math.abs(curr.forecastDailyAvg - prev.forecastDailyAvg) / prev.forecastDailyAvg;
      if (change > 0.5) {
        issues.push({
          level: 'warning',
          code: 'monthly_spike',
          message: `相邻月份预测波动 ${(change * 100).toFixed(0)}%，建议填写调整原因`,
          skuCode: curr.skuCode,
          station: curr.station,
          platform: curr.platform,
          forecastMonth: formatForecastMonth(curr.forecastYear, curr.month),
        });
      }
    }
  }

  return issues;
}

export function hasBlockingForecastIssues(issues: ForecastValidationIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
