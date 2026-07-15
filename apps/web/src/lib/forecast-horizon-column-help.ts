/** 预测明细表头说明（与 forecast-allcat-v41 / forecast-baseline 对齐） */

export type ForecastHorizonColumnMode = 'v41' | 'legacy';

export type ForecastHorizonColumnHelpContext = {
  mode: ForecastHorizonColumnMode;
  /** V4.1 锚定加权公式，如 0.15*d2 + 0.55*d6 + 0.30*d12 */
  anchorFormula?: string;
  /** T1 / T2 …，用于补充说明 */
  tier?: string | null;
  /** T99 层仅诊断 */
  t99Diagnostic?: boolean;
};

const COMMON = {
  month: '预测目标自然月（绝对月）。带 AI 标记的月份由 Dify 辅助预测写入。',
  confidence:
    '算法置信度：high 高 / medium 中 / low 低。V4.1 由商品 T 层决定（T1 高，T2–T3P 中，T4 低）；legacy 由近 90 天动销与品类系数是否裁剪等综合判定。',
  system:
    '系统预测日均 = 混合水平 × 趋势衰减 × 月折减 × T层保守系数，再夹在 [下限, 上限] 内。' +
    ' 趋势比 <0.85 → ×0.85；0.85–1.35 → ×1.00；>1.35 逐级上调；growth 时改用 recent30/recent90 滚动口径。' +
    ' 4–12 月按地平线序号折减；T1 保守 ×0.88（B 类 ×0.86）。' +
    ' 悬停系统数值可看逐月拆解，末行与单元格展示一致。',
  calibration:
    '运营手工校准 manual_daily_avg。草稿版本可编辑；留空则沿用系统值，失焦或回车保存。可附备注说明调整原因。',
  effective: '生效日均 = 校准值 ?? 系统预测。矩阵主数字、补货与库存健康均消费此口径。',
} as const;

const V41 = {
  baseline:
    '混合水平（levelDaily）：锚定与季节朴素按地平线序号混合后的日均，持久化为 baseline_daily_avg。' +
    ' 是套限幅前的中间量；V4.1 模式下「基线」列展示此值，与「系统」列可能不同。',
  d6: '走步特征：目标月之前近 6 个自然月销量合计 q6 ÷ 182 天。反映近半年日均销量；触发预测时锚定，全周期各月相同。',
  trendRatio:
    '趋势比 trendRatio = q3 ÷ (q6 − q3)，衡量近 3 月相对前 3 月的销量比。q6 ≤ q3 时取 1；用于系统预测中的趋势衰减系数。',
  anchor: (formula?: string, tier?: string | null) => {
    const parts = [
      '锚定日均：按商品 T 层对 d2/d3/d6/d12 加权得到的水平锚点。',
      formula ? `当前分层公式：${formula.replace(/\*/g, '×')}` : '具体权重见标题区商品分层。',
      tier ? `（${tier}）` : '',
      '走步特征在触发时锚定，各月相同。',
    ];
    return parts.filter(Boolean).join(' ');
  },
  seasonal:
    '季节朴素日均：截止上月末的近 12 月销量序列，取与目标月日历位对齐的季节朴素月销量，再除以该月天数折算为日均。远月地平线序号越大，季节权重越高。',
  blendLevel:
    '混合水平 = 锚定×(1−w) + 季节朴素×w，w = min(0.62, 0.28 + k×0.07)，k 为地平线序号（首月 k=0）。近端偏锚定，远端偏季节；再经趋势衰减与分层上下限得到「系统」列。',
} as const;

const LEGACY = {
  baseline:
    '混合基线 baseline_daily_avg = w近×近端 + w同比×结构水平。未乘品类季节/趋势系数前的水平；随地平线 k 变化。',
  wNear: '近端权重 wNear：地平线越远越小，近月更依赖近期销量水平。',
  wYoy: '同比权重 wYoy = 1 − w近：远月更依赖去年同月与结构水平。',
  nearLevel: '近端水平 near_level：由近 30/90 天与生命周期权重混合，反映近期动销。',
  structuralLevel: '结构水平 structural_level：由去年同月 YoY 与增长因子推导的中期结构参考。',
  growthFactor: '增长因子 growth_factor：近端相对结构水平的 YoY 增长比，经裁剪后参与混合。',
  yoyMonthLevel: 'YoY 月水平 yoy_month_level：去年同月实际销量折算的日均参考。',
  seasonality: '季节系数：从品类/项目组趋势表按日历月 1–12 取值，裁剪至 [0.7, 1.3]。',
  trend: '趋势系数：锚点月相对上月的品类趋势环比，裁剪至 [0.7, 1.3]。',
  categoryCombined:
    '品类综合 = 季节系数 × 趋势系数（展示用，v2 分别裁剪后相乘）。无匹配品类时默认 1.00。',
} as const;

export function getForecastHorizonColumnHelp(
  column:
    | 'month'
    | 'confidence'
    | 'baseline'
    | 'd6'
    | 'trendRatio'
    | 'anchor'
    | 'seasonal'
    | 'blendLevel'
    | 'wNear'
    | 'wYoy'
    | 'nearLevel'
    | 'structuralLevel'
    | 'growthFactor'
    | 'yoyMonthLevel'
    | 'seasonality'
    | 'trend'
    | 'categoryCombined'
    | 'system'
    | 'calibration'
    | 'effective',
  ctx: ForecastHorizonColumnHelpContext,
): string {
  const { mode, anchorFormula, tier, t99Diagnostic } = ctx;
  const t99Note = t99Diagnostic
    ? ' T99 层系统预测为 0，锚定/季节/混合水平仅供诊断。'
    : '';

  switch (column) {
    case 'month':
      return COMMON.month;
    case 'confidence':
      return COMMON.confidence;
    case 'baseline':
      return mode === 'v41' ? V41.baseline : LEGACY.baseline;
    case 'd6':
      return V41.d6;
    case 'trendRatio':
      return V41.trendRatio;
    case 'anchor':
      return V41.anchor(anchorFormula, tier) + t99Note;
    case 'seasonal':
      return V41.seasonal + t99Note;
    case 'blendLevel':
      return V41.blendLevel + t99Note;
    case 'wNear':
      return LEGACY.wNear;
    case 'wYoy':
      return LEGACY.wYoy;
    case 'nearLevel':
      return LEGACY.nearLevel;
    case 'structuralLevel':
      return LEGACY.structuralLevel;
    case 'growthFactor':
      return LEGACY.growthFactor;
    case 'yoyMonthLevel':
      return LEGACY.yoyMonthLevel;
    case 'seasonality':
      return LEGACY.seasonality;
    case 'trend':
      return LEGACY.trend;
    case 'categoryCombined':
      return LEGACY.categoryCombined;
    case 'system':
      return COMMON.system + (t99Diagnostic ? ' T99 层固定为 0.00。' : '');
    case 'calibration':
      return COMMON.calibration;
    case 'effective':
      return COMMON.effective;
    default:
      return '';
  }
}
