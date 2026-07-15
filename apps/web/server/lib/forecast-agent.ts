import type { ForecastValidationIssue } from './forecast-validation.js';
import { formatForecastMonth } from './forecast-demand.js';

export function buildForecastReviewSummary(params: {
  versionName: string;
  versionStatus: string;
  issues: ForecastValidationIssue[];
  rowCount: number;
}): string {
  const errors = params.issues.filter((i) => i.level === 'error');
  const warnings = params.issues.filter((i) => i.level === 'warning');

  const lines = [
    `【销售预测复核】版本：${params.versionName}（${params.versionStatus}）`,
    `预测明细行数：${params.rowCount}`,
    `异常：错误 ${errors.length} 条，警告 ${warnings.length} 条`,
  ];

  if (warnings.length) {
    lines.push('', '主要警告：');
    for (const w of warnings.slice(0, 8)) {
      lines.push(
        `- [${w.code}] ${w.skuCode ?? '-'} ${w.station ?? ''} ${w.forecastMonth ?? ''}: ${w.message}`,
      );
    }
    if (warnings.length > 8) lines.push(`... 另有 ${warnings.length - 8} 条`);
  }

  if (!errors.length && !warnings.length) {
    lines.push('', '未发现明显口径问题，可进入发布流程。');
  }

  return lines.join('\n');
}

export function buildForecastAccuracyDigest(
  rows: Array<{
    skuCode: string;
    station: string;
    platform: string;
    forecastMonth: string;
    mape: number | null;
    biasRate: number | null;
  }>,
  totalCount?: number,
): string {
  const highErrorCount = rows.filter((r) => r.mape != null && r.mape > 0.3).length;

  return [
    '【预测准确率摘要】',
    `统计 SKU 数：${totalCount ?? rows.length}`,
    `高偏差 SKU（MAPE>30%）：${highErrorCount}`,
  ].join('\n');
}

export function formatForecastMonthLabel(year: number, month: number): string {
  return formatForecastMonth(year, month);
}
