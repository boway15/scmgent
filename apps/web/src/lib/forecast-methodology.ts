export type ForecastMethodologyTable = {
  /** 表格标题，如「场景 A：成熟 SKU」 */
  caption?: string;
  headers: string[];
  rows: string[][];
};

export type ForecastMethodologySection = {
  title: string;
  paragraphs?: string[];
  items?: string[];
  /** @deprecated 使用 tables */
  table?: ForecastMethodologyTable;
  tables?: ForecastMethodologyTable[];
};

function t(
  caption: string | undefined,
  headers: string[],
  rows: string[][],
): ForecastMethodologyTable {
  return caption ? { caption, headers, rows } : { headers, rows };
}

/** 与 apps/web/server/lib/forecast-baseline.ts、forecast-collaboration.ts、forecast-horizon.ts、forecast-demand.ts 对齐 */
export const FORECAST_METHODOLOGY_SECTIONS: ForecastMethodologySection[] = [
  {
    title: '模块导航',
    paragraphs: ['按业务模块查阅；实现文件见各表「代码位置」列。'],
    table: {
      headers: ['模块', '页面入口', '主要输出', '实现'],
      rows: [
        ['销量历史', '数据中心 → 销量历史', '日表 / SKU 月表', 'sales-history-import'],
        ['品类系数', '预测策略 → 品类趋势系数', '季节 × 趋势系数', 'forecast-collaboration'],
        ['预测生成', '销量预测 → 生成预测', '草稿版本 + 逐月 forecast_daily_avg', 'forecast-collaboration'],
        ['复核发布', '销量预测 → 复核与发布', '矩阵核对 + 发布', 'forecast-horizon'],
        ['查询复盘', '销量预测 → 查询复盘', '历史/未来/准确率', 'forecast-horizon / forecast-accuracy'],
        ['补货消费', '补货建议 / 库存健康', '按日取预测日均', 'forecast-demand + replenishment'],
      ],
    },
  },
  {
    title: '一、数据前提与数据源',
    paragraphs: [
      '预测不依赖手工上传预测 CSV；全部从已入库销量历史推导。站点通过仓库 region 映射过滤日销量；平台支持 ALL（全平台汇总）或分平台行（AMAZON 等）。',
    ],
    tables: [
      t('数据源字典', ['数据对象', '来源', '粒度', '用途', '示例'], [
        [
          'sales_history_daily',
          'xiaoshou 日销量宽表导入',
          'SKU × 日 × 平台',
          '近 30/90 天、去年同月、生命周期',
          '2025-03-15 售出 12 件',
        ],
        [
          'sales_history_monthly',
          '日表聚合 + 月表导入',
          'SKU × 自然月 × 平台',
          '品类系数、yoy 结构、历史矩阵',
          '2025-03 月销 360 件',
        ],
        [
          'sales_forecast_seasonality',
          '从 SKU 月表汇总刷新',
          '品类/项目组 × 日历月 1–12',
          '季节系数、趋势系数',
          '类目「家居」3 月系数 1.08',
        ],
        [
          'sales_forecast_monthly',
          '生成预测写入',
          'SKU × 站点 × 平台 × 绝对月',
          '复核矩阵、补货消费',
          '2026-07 forecast_daily_avg=5.2',
        ],
      ]),
    ],
  },
  {
    title: '二、时间窗口与预测地平线',
    tables: [
      t('时间概念', ['概念', '定义', '计算 / 规则', '示例（假设今天 2026-06-30）'], [
        [
          '预测地平线起点',
          '未来矩阵第一列',
          '从当前自然月起算（当月算未来月）',
          '首列 2026-06',
        ],
        [
          'effectiveRecentWindowEnd',
          '近期窗口截止日',
          '当月未过完 → 截止到上月月末；已过完 → 当月月末',
          '2026-05-31',
        ],
        [
          '近 30 天窗口',
          'recent30',
          '[windowEnd−29, windowEnd] 内销量 ÷ 30',
          '5/2–5/31 共 150 件 → 5.0 件/天',
        ],
        [
          '近 90 天窗口',
          'recent90',
          '[windowEnd−89, windowEnd] 内销量 ÷ 90（断货日剔除后）',
          '3/3–5/31 共 450 件 → 5.0 件/天',
        ],
        [
          '历史矩阵',
          'actual_daily_avg',
          '销量月表 qty_sold ÷ 当月自然日数；不含当月',
          '2025-05 月销 310 件 → 10.0 件/天',
        ],
        [
          '地平线序号 k',
          'horizon_month_index',
          'k=0 为当月，k=1 为下月，以此类推',
          '2026-08 对应 k=2',
        ],
      ]),
    ],
  },
  {
    title: '三-B、SKU 准入与分层 KPI',
    paragraphs: [
      '生成预测前按销量信号准入：recent90>0、recent30>0、近 12 月动销天数≥30，或 skus.force_forecast=true。不满足则跳过预测行并写入 forecast_skipped 复核项。',
      '准确率复盘按 6 个月均实际日均分层：主力≥5/日、腰部 1–5/日、长尾<1/日。主 KPI 为销量加权 WMAPE（非算术均 MAPE）。偏差=(实际−预测)/预测，负=高估。',
      '零近期销量 SKU 不再注入品类中位数参考（intermittent / recent90=0 禁止品类掺入）。',
    ],
    table: {
      headers: ['档位', '条件', '主指标'],
      rows: [
        ['主力 core', '均实际 ≥5/日', 'WMAPE、加权 bias'],
        ['腰部 mid', '1–5/日', 'WMAPE'],
        ['长尾 tail', '<1/日', 'WAPE 或命中率'],
        ['跳过 skipped', '准入未通过', '不生成预测'],
      ],
    },
  },
  {
    title: '三-C、生命周期分流（v2.1）',
    paragraphs: [
      'intermittent：forecast = min(recent90, max(recent30,recent90)×1.15)，不乘品类季节趋势。',
      'new：growth_factor=1；k≥3 用 near×ramp 禁 structural 主导；复核低置信 warning。',
      'decline 或 recent30<0.8×recent90：季节系数向 1 收缩 50%，趋势上限 1.0；k=0 时 w_near 0.65→0.50。',
      'stockout_suspected：growth_factor 上限 1.0（非 1.3）。',
      '成熟/decline 且下滑信号：k=0~2 预测封顶 recent30/(1−20%)；k=3~5 封顶 recent30/(1−35%)；k≥3 季节系数不超过 1.0。',
    ],
  },
  {
    title: '三-D、偏差预算（业务目标）',
    paragraphs: [
      '主力 SKU 走步回测验收目标：地平线 k=0~2（前 3 个预测月）|bias|≤20%；k=3~5（第 4~6 月）|bias|≤35%。',
      '偏差=(实际−预测)/预测；负=高估。成熟/下滑/增长 SKU 经 computeBiasBudgetAnchor 收缩锚点（YoY 增长回落、平盘 15% 折扣、近月/远月衰减），再封顶 forecast ≤ anchor/(1−budget)。',
    ],
    table: {
      headers: ['地平线 k', '预测月序', '目标 |bias|', '算法封顶'],
      rows: [
        ['0~2', '前 3 个月', '≤20%', 'forecast ≤ anchor(k) / 0.8 × 0.985'],
        ['3~5', '第 4~6 个月', '≤35%', 'forecast ≤ anchor(k) / 0.65 × 0.985'],
      ],
    },
  },
  {
    title: '三、v2 总公式（地平线感知，当前生效）',
    paragraphs: [
      '对地平线第 k 月（目标绝对月 m），先算混合基线 baseline(k)，再乘品类季节与趋势。季节、趋势在 v2 中分别裁剪到 [0.7, 1.3] 后相乘（非合并乘积一次裁剪）。',
      'forecast_daily_avg(k) = baseline(k) × clip(季节, 0.7~1.3) × clip(趋势, 0.7~1.3)',
    ],
    tables: [
      t('公式链路（按计算顺序）', ['步骤', '符号 / 字段', '公式', '回退规则'], [
        ['1', 'near_level', '生命周期加权(近30, 近90[, 品类参考])', '无 90 天销 → 用 30 天或品类中位数'],
        ['2', 'yoy_anchor_level', '近3自然月日均 vs 去年同3月日均（锚点=生成日所在月）', '无去年数据 → 用 yoy_month 或 near_level'],
        ['3', 'growth_factor', 'clip(near_level ÷ yoy_anchor, 0.7~1.3)', '分母≤0 → 1'],
        ['4', 'yoy_month_level', '目标月 m 的去年同月日均', '日表优先，否则月表；再否则历史同月均值'],
        ['5', 'structural_level', 'yoy_month_level × growth_factor', '无同比 → near_level'],
        ['6', 'baseline_daily_avg', 'w_near(k)×near_level + w_yoy(k)×structural_level', '—'],
        ['7', 'forecast_daily_avg', 'baseline × 季节 × 趋势', '四舍五入到 4 位小数'],
      ]),
      t('数值示例（成熟 SKU，k=0，2026-06）', ['中间量', '取值', '计算过程'], [
        ['recent30', '6.0', '近 30 天 180 件 ÷ 30'],
        ['recent90', '5.0', '近 90 天 450 件 ÷ 90'],
        ['near_level', '5.35', '0.65×5.0 + 0.35×6.0'],
        ['yoy_anchor_level', '4.5', '近3月 vs 去年同3月锚点'],
        ['growth_factor', '1.19', 'clip(5.35÷4.5, 0.7~1.3)'],
        ['yoy_month_level', '4.8', '2025-06 月销折算日均'],
        ['structural_level', '5.71', '4.8 × 1.19'],
        ['w_near / w_yoy', '0.65 / 0.35', 'k=0 默认权重'],
        ['baseline', '5.48', '0.65×5.35 + 0.35×5.71'],
        ['季节 × 趋势', '1.05 × 1.02', '品类「家居」6 月系数'],
        ['forecast_daily_avg', '5.86', '5.48 × 1.05 × 1.02 ≈ 5.86'],
      ]),
      t('k 与混合权重（w_near + w_yoy = 1）', ['k', 'w_near', 'w_yoy', '业务含义'], [
        ['0（当月）', '65%', '35%', '仍保留较多近期信号'],
        ['1', '50%', '50%', '近期与同比各半'],
        ['2', '35%', '65%', '同比结构为主'],
        ['3', '28%', '72%', 'k=3~5 时 w_near 每月约 −7%，下限 15%'],
        ['4', '21%', '79%', ''],
        ['5', '15%', '85%', ''],
        ['≥6', '10%', '90%', '远期几乎完全依赖同比结构'],
      ]),
    ],
  },
  {
    title: '四、近期销量指标',
    tables: [
      t('指标字典', ['指标', '字段 / 展示名', '计算公式', '代码位置', '示例'], [
        [
          '近 30 天日均',
          'recent30DailyAvg',
          'sum(qty, [end−29, end]) / 30',
          'forecast-collaboration',
          '180÷30=6.0',
        ],
        [
          '近 90 天日均',
          'recent90DailyAvg',
          'sum(qty, [end−89, end]) / 90',
          'forecast-collaboration',
          '450÷90=5.0',
        ],
        [
          '动销日占比',
          'salesDayRatio90',
          '近90天 qty>0 的天数 / 90',
          'classifySalesLifecycle',
          '27/90=30%',
        ],
        [
          '最长连续零销',
          'maxZeroRunDays',
          '近90窗口内最长连续 0 销天数',
          'collectStockoutExcludedDates',
          '连续 10 天为 0 → 10',
        ],
        [
          '首销距今天数',
          'ageDays',
          'today − first_sale_date',
          'computeAgeDaysFromFirstSale',
          '首销 60 天前 → 60',
        ],
        [
          '品类参考日均',
          'categoryReferenceDailyAvg',
          '同品类 SKU 的 recent90 中位数',
          'computeCategoryReferenceBySku',
          '品类中位 4.2 件/天',
        ],
      ]),
      t('断货抑制规则', ['规则', '条件', '处理', '影响'], [
        [
          '零销段剔除',
          '近90天内连续 ≥7 天 qty=0',
          '这些日期从近期窗口剔除后再算日均',
          '避免断货把 recent90 压低',
        ],
        [
          '疑似断货生命周期',
          '最长零销≥7 且 recent90>0 且 age≥90 且动销日≥10%',
          '标记 stockout_suspected，写入风险提示',
          'near_level 仍用 65%×90d+35%×30d',
        ],
      ]),
    ],
  },
  {
    title: '五、生命周期判定与 near_level',
    paragraphs: [
      'v2 中生命周期主要影响 near_level（近端水平），不再作为远期主基线的唯一来源。优先级从高到低匹配，命中即停止。',
    ],
    tables: [
      t('生命周期判定', ['优先级', '标签', '判定条件（须全部满足）', '代码枚举'], [
        [
          '1',
          '疑似断货',
          '最长连续零销≥7；recent90>0；age≥90；动销日占比≥10%',
          'stockout_suspected',
        ],
        ['2', '新品', '首销 <90 天', 'new'],
        ['3', '间歇', '近90动销日占比 <10%', 'intermittent'],
        ['4', '增长', 'recent30 ≥ recent90×1.3', 'growth'],
        ['5', '下滑', 'recent30 ≤ recent90×0.7', 'decline'],
        ['6', '成熟', '以上皆不满足', 'mature'],
      ]),
      t('near_level 权重（v2）', ['生命周期', '公式', '数值示例（recent30=6, recent90=5, 品类=4）'], [
        ['成熟 / 疑似断货', '0.65×recent90 + 0.35×recent30', '0.65×5+0.35×6=5.35'],
        ['增长', '(w90+wLy)×90 + w30×30，权重表 growth', '0.85×5+0.5×6 按权重归一'],
        ['下滑', '同增长，decline 权重表', '偏重 90 天'],
        ['间歇', '0.8×recent90 + 0.2×recent30', '0.8×5+0.2×6=5.2'],
        ['新品', '0.7×recent30 + 0.3×品类参考', '0.7×6+0.3×4=5.4'],
        ['无 90 天销', '0.7×recent30 + 0.3×品类 或仅品类', '新品兜底'],
      ]),
    ],
  },
  {
    title: '六、同比结构（yoy_month / yoy_anchor / growth）',
    tables: [
      t('字段字典', ['字段', '含义', '计算公式', '数据优先级', '示例'], [
        [
          'yoy_month_level',
          '目标月去年同月日均',
          'last_year(m) 月销量 ÷ 该月天数',
          '日表同月汇总 → SKU月表 → 历年同月均值',
          '2025-07 月销 372 件 → 12.0/天',
        ],
        [
          'yoy_anchor_level',
          '增长锚点（去年水平）',
          'mean(去年同3个自然月的日均)',
          '生成日 refYear/refMonth 往前 3 月',
          '去年 3–5 月日均均值 4.5',
        ],
        [
          'growth_factor',
          '近期相对去年的增长',
          'clip(near_level ÷ yoy_anchor, 0.7~1.3)',
          '锚点≤0 时取 1',
          '5.35÷4.5=1.19',
        ],
        [
          'structural_level',
          '同比结构水平',
          'yoy_month × growth；无 yoy_month 时用 near_level',
          '—',
          '12.0×1.1=13.2',
        ],
      ]),
      t('场景对照', ['场景', 'yoy_month', 'growth', 'structural 结果'], [
        ['有完整去年同月', '12.0', '1.1', '13.2'],
        ['无去年同月，有历年7月均值', 'estimateCalendarMonth(7)', '1.0', '均值×1'],
        ['无任何同比', '0 → 回退', '—', 'structural = near_level'],
      ]),
    ],
  },
  {
    title: '七、品类季节与趋势系数',
    paragraphs: [
      '从 SKU 月表按品类路径、项目组汇总月销量（Rebuild 前对 SKU 月销做大促/缺货清洗）；对每个维度 × 日历月 1–12 存一组系数。',
      '保守口径：季节=近6月月均÷去年同6月；趋势=近3月均÷前3月均；综合 clip [0.85,1.15]，超界则不应用（=1）。',
    ],
    tables: [
      t('系数计算（锚点月 endYear-endMonth）', ['系数', '公式', '锚点选取', '示例'], [
        [
          '季节 seasonality_factor',
          '近6月（含锚点）品类月均 ÷ 去年同6月月均',
          'resolveSeasonalityAnchor：预测月日历月决定锚点绝对月',
          '今年 H1 均/去年 H1 均',
        ],
        [
          '趋势 trend_factor',
          '近3月月均 ÷ 前3月月均',
          '非单月 MoM，降低噪声',
          'Q2均/Q1均',
        ],
        [
          '综合 combined_factor',
          'clip(季节 × 趋势, 0.85~1.15)；超界→1',
          '矩阵展示用；wasClipped 标黄',
          '1.05',
        ],
      ]),
      t('匹配与回退', ['步骤', '规则', '未命中时'], [
        ['1', 'SKU category 路径从叶到根逐段查 category 维度', '继续下一段'],
        ['2', '查 project_group 维度', '季节=1, 趋势=1'],
        ['3', '按目标月 calendar month 1–12 取系数', '不区分绝对年'],
      ]),
    ],
  },
  {
    title: '八、预测输出字段（持久化与页面）',
    tables: [
      t('sales_forecast_monthly 主字段', ['字段', '中文名', '含义', '公式 / 来源', '抽屉 / 矩阵列'], [
        ['forecast_daily_avg', '系统预测日均', '算法生成，重新生成会更新', 'v2 公式输出', '抽屉「系统」列、明细'],
        ['manual_daily_avg', '校准日均', '运营手工覆盖（可空）', 'PUT /sales-forecasts/:id', '抽屉可编辑（仅草稿）'],
        ['生效日均', 'effective', '下游消费口径', 'manual ?? forecast', '矩阵主数字、补货'],
        ['baseline_daily_avg', '混合基线', '未乘品类系数前的水平', 'w_near×near + w_yoy×structural', '未来明细'],
        ['lifecycle', '生命周期', '判定标签', 'classifySalesLifecycle', '矩阵、抽屉标题区'],
        ['confidence_level', '置信度', 'high / medium / low', '见下表', '未来明细'],
        ['horizon_factors', 'v2 因子快照', 'jsonb', 'near/structural/w/growth 等', '未来明细各列'],
        ['sku_trend_factor', 'SKU趋势（展示）', '派生值，不参与 v2 乘积', 'structural÷near', '未来明细'],
        ['seasonality_factor', '季节系数', '品类表', 'computeSeasonalityFactorAtAnchor', '未来明细'],
        ['trend_factor', '趋势系数', '品类表', '锚点月环比', '未来明细'],
        ['category_combined_factor', '品类综合', '季节×趋势（展示）', '可能已裁剪', '未来明细'],
      ]),
      t('horizon_factors 子字段', ['JSON 键', '页面列名', '含义'], [
        ['nearLevel', '近端', 'near_level'],
        ['structuralLevel', '结构', 'structural_level'],
        ['yoyMonthLevel', 'YoY月', 'yoy_month_level'],
        ['yoyAnchorLevel', '增长锚点', 'yoy_anchor_level'],
        ['growthFactor', '增长', 'growth_factor'],
        ['wNear', 'w近', '近端权重'],
        ['wYoy', 'w同比', '同比权重'],
        ['horizonMonthIndex', '—', '地平线序号 k'],
      ]),
      t('历史矩阵字段', ['字段', '公式', '说明', '示例'], [
        ['qty_sold', 'SKU 月表月销量', '按平台口径，非站点级', '2025-05: 310 件'],
        ['actual_daily_avg', 'qty_sold ÷ 当月天数', '与品类趋势历史矩阵一致', '310÷31=10.0'],
      ]),
    ],
  },
  {
    title: '九、置信度',
    table: {
      headers: ['等级', '判定条件', '业务建议'],
      rows: [
        ['高 high', 'recent90>0 且 有去年同月 且 品类系数未裁剪', '可优先自动发布或抽样核对'],
        ['中 medium', 'recent90>0', '建议对照历史矩阵看趋势'],
        ['低 low', '其余（历史不足、无近90销）', '重点人工看 near_level 与品类参考'],
      ],
    },
  },
  {
    title: '十、补货与下游消费',
    paragraphs: ['仅「已发布」版本的预测参与补货；按 SKU × 站点 × 平台读取逐月 forecast_daily_avg。'],
    tables: [
      t('消费规则', ['函数 / 场景', '计算方式', '示例'], [
        [
          'getForecastDailyForDate',
          '取 date 所在自然月的预测日均',
          '2026-08-15 → 用 2026-08 月预测值',
        ],
        [
          'calcForwardAvgDaily',
          '未来 N 天每日预测求平均',
          '覆盖天数内跨月按各月日均加权',
        ],
        [
          'calcCoverageDaysWithForecast',
          '库存 ÷ 逐日预测模拟耗尽天数',
          '支持按月不同日均',
        ],
        [
          'aggregateForecastRows',
          '多平台行聚合',
          '有分平台行则求和；仅 ALL 则用 ALL；禁止混用',
        ],
      ]),
    ],
  },
  {
    title: '十一、准确率复盘',
    tables: [
      t('指标', ['指标', '公式', '页面', '示例'], [
        ['forecast_daily_avg', '发布版该月预测日均', '准确率表', '预测 5.0'],
        ['actual_daily_avg', '该月实际日均', '准确率表', '实际 6.0'],
        ['bias_rate', '(实际−预测)÷预测', '准确率表', '(6−5)/5=20%'],
        ['MAPE', '|实际−预测|÷实际（实际>0）', '准确率表', '|6−5|/6=16.7%'],
      ]),
      t('回测触发', ['条件', '动作'], [
        ['MAPE > 30%', '写入 low_accuracy 风险提示（不阻塞发布）'],
        ['实际=0 且 预测>0', '同上，疑似高估'],
      ]),
    ],
  },
  {
    title: '十二、系统风险提示（后台记录）',
    paragraphs: [
      '生成时约 10%–20% SKU 写入 sales_forecast_review_items，供 AI 摘要或后续筛选；复核页以矩阵逐月预测为主，无需逐项点选确认，不阻塞发布。',
    ],
    table: {
      headers: ['issue_type', '等级', '触发条件', 'message 要点'],
      rows: [
        ['high_value', '严重', '近90天销量 Top 5%', '展示跨月预测均值供对照，非写入字段'],
        ['trend_shift', '预警', '生命周期=增长或下滑', '提示促销/结构变化'],
        ['stockout_suspected', '预警', '疑似断货判定命中', '提示断货抑制需求'],
        ['missing_history', '提示', '历史不足 / 低置信', '近90动销<7天或历史<30天'],
        ['category_deviation', '提示/预警', '品类系数裁剪或未应用', '系数值写入 message'],
        ['low_accuracy', '预警', '准确率回测 MAPE>30%', '回测任务产生'],
        ['platform_mix', '提示', '同 SKU 既有 ALL 又有分平台', '口径混用提醒'],
      ],
    },
  },
  {
    title: '十三、ABCD 商品分类 × 决策窗口 KPI',
    paragraphs: [
      'SKU×站点×平台每月按近 12 月销量重算 ABCD 大类与 12 子档；准确率矩阵按子档×窗口（1–3 / 3–6 / 6–12 月）考核 WMAPE。',
      'A·常青款·主力：近月锚定 + 双向偏差预算 15%/25%；B·爆款趋势款输出 P10–P90；C·长尾款按品类池分解；D·问题款仅下限管理，不考核 WMAPE。',
    ],
    table: {
      headers: ['子档', '1–3 月 KPI', '3–6 月 KPI', '6–12 月 KPI', '说明'],
      rows: [
        ['A·常青款·主力', '≤15%', '≤25%', '≤35%', '精准备货硬门禁'],
        ['A·常青款·腰部', '≤20%', '≤30%', '≤40%', '软门禁'],
        ['B·爆款趋势款·腰部', '≤22%+覆盖', '≤28%', '±40% 区间', '残差分位数区间'],
        ['C·长尾款·品类池', '≤20%', '≤25%', '≤35%', '池级考核，SKU 分解仅展示'],
        ['D·问题款', 'ghost=0', '—', '—', '风险档，不考核 WMAPE'],
      ],
    },
  },
  {
    title: '十四、页面视图对照',
    table: {
      headers: ['视图', '行维度', '列 / 内容', '单元格含义', '典型用途'],
      rows: [
        ['未来矩阵', 'SKU×站点×平台', '当月起 N 个绝对月', 'forecast_daily_avg', '复核逐月是否合理'],
        ['历史矩阵', '同上', '过去 N 个绝对月（不含当月）', 'actual_daily_avg', '对照往年走势'],
        ['明细', '同上（长表）', '月份 + 历史/未来标记', '日均 + 因子列', '导出式核对'],
        ['品类趋势-未来', '品类/项目组', '未来各月', 'combined_factor', '看品类季节性'],
        ['品类趋势-历史', '品类/项目组', '历史各月', 'combined_factor', '验证系数是否合理'],
        ['SKU 抽屉', '单 SKU', '历史表 + 未来因子表', '见第八节', '深度核对单月因子'],
      ],
    },
  },
  {
    title: '十五、旧版 v1（已废弃，仅供对照）',
    items: [
      'baseline = 生命周期加权(近30, 近90, 去年同月, 品类参考)',
      'sku_trend(k) = clip(近30÷近90) 再按 6 个月半衰期衰减',
      'forecast = baseline × sku_trend(k) × clip(季节×趋势, 0.7~1.3)',
      '问题：12 个月共用同一组近 30/90 天，远期月预测不合理（各月数值趋同）。重新生成后切换 v2。',
    ],
  },
  {
    title: '十六、推荐操作流程',
    items: [
      '① 销量历史导入 → ② 预测策略查看品类系数（可选刷新）→ ③ 生成预测',
      '④ 复核与发布：未来/历史矩阵对照 → 点击 SKU 看逐月因子 → 版本管理发布',
      '⑤ 查询复盘：准确率回测（可选）',
      '需干净重算：页头「清空预测数据」后重新生成；无 horizon_factors 的旧草稿需重新生成才有 v2 明细。',
    ],
  },
];
