export type ForecastAccuracyMetricKey =
  | 'monthlyAvgMape'
  | 'monthlyAvgWmape'
  | 'pooledMape'
  | 'pooledWmape'
  | 'rowMape'
  | 'rowWmape'
  | 'highMapeRowPct'
  | 'ghostRows'
  | 'zeroForecastMiss';

export type ForecastAccuracyMetricDef = {
  label: string;
  /** 悬停提示与说明区展示的完整公式 */
  formula: string;
  /** 表头下可选的一行简写 */
  short?: string;
  /** 是否为主 KPI（展示时优先） */
  primary?: boolean;
};

export const FORECAST_ACCURACY_METRICS: Record<ForecastAccuracyMetricKey, ForecastAccuracyMetricDef> = {
  monthlyAvgMape: {
    label: '月均 MAPE',
    short: '主 KPI · 有符号',
    primary: true,
    formula:
      '各预测月先算 MAPE = Σ(预测日均−实际日均) ÷ Σ实际日均（仅 T1–T4A 等 KPI 可比行），再对月份取算术平均。正数=偏高估，负数=偏低估。',
  },
  monthlyAvgWmape: {
    label: '月均 WMAPE',
    short: '辅 KPI · 绝对误差',
    formula:
      '各预测月先算 WMAPE = Σ|预测日均−实际日均| ÷ Σ实际日均（仅 KPI 可比行），再对月份取算术平均（每月一票）。',
  },
  pooledMape: {
    label: '全期 MAPE',
    short: '主 KPI · 有符号',
    primary: true,
    formula:
      '诊断期内全部预测>0 行汇总：Σ(预测日均−实际日均) ÷ Σ实际日均（分母仅实际>0；含 T4B / ghost 误差）。正数=偏高估，负数=偏低估。',
  },
  pooledWmape: {
    label: '全期 WMAPE',
    short: '辅 KPI · 绝对误差',
    formula:
      '诊断期内全部预测>0 行汇总：Σ|预测日均−实际日均| ÷ Σ实际日均（分母仅实际>0；ghost 计入分子）。',
  },
  rowMape: {
    label: 'MAPE',
    short: '当月有符号',
    primary: true,
    formula: '当月该行：(预测日均−实际日均) ÷ 实际日均。正数=偏高估，负数=偏低估（仅实际>0）。',
  },
  rowWmape: {
    label: 'WMAPE',
    short: '当月绝对误差',
    formula: '当月该行：|预测日均−实际日均| ÷ 实际日均（仅实际>0）。',
  },
  highMapeRowPct: {
    label: '高偏差行',
    short: '|MAPE|>30%',
    formula: 'KPI 可比行中 |MAPE| > 30% 的行数 ÷ KPI 可比行总数。',
  },
  ghostRows: {
    label: 'Ghost',
    short: '零销误预测',
    formula: '实际日均=0 且 预测日均>0 的行数（虚假需求）。',
  },
  zeroForecastMiss: {
    label: '漏报',
    short: '有销零预测',
    formula: '实际日均>0 且 预测日均=0 的行数（漏掉真实需求）。',
  },
};

export const FORECAST_ACCURACY_DIAGNOSTICS_LEGEND_INTRO =
  '主 KPI 为全期 MAPE（有符号）；辅 KPI 为全期 WMAPE（绝对误差）。统计纳入全部预测>0 行（含 T4B / ghost）；MAPE/WMAPE 分母仅实际>0 行，ghost 误差计入分子。';

export const FORECAST_ACCURACY_METRICS_LEGEND_INTRO =
  '主 KPI 为月均 MAPE（有符号）；辅 KPI 为月均 WMAPE（绝对误差）。汇总均排除 T4B/T99/D 层，先按月计算再对月份算术平均；列表每行为单月口径。';

/** @deprecated 使用 monthlyAvgMape */
export const monthlyAvgBias = FORECAST_ACCURACY_METRICS.monthlyAvgMape;
