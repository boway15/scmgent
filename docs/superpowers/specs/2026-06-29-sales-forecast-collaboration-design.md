# 销量预测工作台 PRD

## 1. 需求分析

### 背景

运营目前可稳定提供两份销量数据：

- 每日 SKU 销量表：SKU、SKU 名称、站点、平台、首单时间、品类、每日销量宽表，覆盖 2024-01-01 至 2026-06-26。
- 月度销量表：项目组与品类维度月度销量，覆盖 2023-01 至 2026-05。

系统需要在数据输入有限的前提下，先做可解释、可复核、可持续变准的销量预测。第一优先级是补货决策，第二优先级是经营趋势看板。

### 产品定位

采用「运营协同预测」方案：

系统负责清洗销量数据、生成 SKU 级基线预测、识别异常、提供项目组/品类趋势校验；运营负责复核业务变化、调整重点 SKU；发布后的预测版本直接驱动补货建议、安全库存、缺货预警与 PMC 需求计划。

### 用户角色

| 角色 | 权限 | 典型操作 |
|------|------|----------|
| 运营 | 上传销量表、查看预测、调整预测 | 上传销量数据、复核异常 SKU、填写调整原因 |
| 采购/PMC | 查看已发布预测与补货建议 | 基于预测生成需求计划、跟进采购 |
| 管理者 | 查看经营趋势和预测准确率 | 查看品类/项目组趋势、关注高偏差 SKU |
| 系统管理员 | 配置映射与权限 | 维护平台别名、站点映射、导入权限 |

### 用户故事

- 作为运营，我希望上传每日 SKU 销量表后，系统自动生成未来 12 个月预测日均，以便不用手工维护 6000+ SKU 的预测。
- 作为运营，我希望系统只让我复核异常 SKU 和重点 SKU，以便把时间花在真正影响补货风险的地方。
- 作为采购/PMC，我希望补货建议使用已发布的预测版本，以便需求计划有明确依据。
- 作为管理者，我希望看到预测准确率和品类趋势偏差，以便判断预测是否可信。

### 成功指标

- Top 销量 SKU 的预测覆盖率达到 95% 以上。
- 预测版本发布后，可被补货计算稳定使用。
- 运营日常复核范围控制在全部 SKU 的 10%-20%。
- 每月能输出高偏差 SKU 清单，并进入下一轮复核。

## 2. 数据模型

### 已有核心表

#### sales_history（销量历史）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | 是 | 主键 |
| sku_id | uuid | 是 | SKU 外键 |
| sale_date | date | 是 | 销售日期 |
| qty_sold | integer | 是 | 销量 |
| channel | varchar(100) | 否 | 销售平台/渠道 |
| warehouse_code | varchar(100) | 否 | 发货仓 |
| source | enum | 是 | manual/import/sync |
| import_batch_id | uuid | 否 | 导入批次 |
| created_at | timestamptz | 是 | 创建时间 |

用途：承接每日 SKU 销量表清洗后的长表数据，是 SKU 级预测主来源。

#### sales_forecast_monthly（销量预测月度明细）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | 是 | 主键 |
| sku_id | uuid | 是 | SKU 外键 |
| station | varchar | 是 | 站点，如 US/DE/UK |
| platform | varchar | 是 | 平台，如 AMAZON/WALMART/ALL |
| forecast_year | integer | 是 | 预测年份 |
| month | integer | 是 | 预测月份 |
| forecast_daily_avg | numeric | 是 | 最终预测日均 |
| baseline_daily_avg | numeric | 否 | 系统基线日均 |
| manual_daily_avg | numeric | 否 | 运营调整日均 |
| adjust_reason | text | 否 | 调整原因 |
| confidence_level | enum | 否 | high/medium/low |
| lifecycle | varchar | 否 | SKU 生命周期 |
| owner_name | varchar | 否 | 负责人 |
| source | enum | 是 | import/manual/system |
| version_id | uuid | 否 | 预测版本 |
| import_batch_id | uuid | 否 | 导入批次 |
| updated_at | timestamptz | 是 | 更新时间 |

用途：保存未来 12 个月 SKU 级月度日均预测，发布后驱动补货。

#### sales_forecast_versions（预测版本）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | 是 | 主键 |
| version_no | varchar | 是 | 版本号 |
| version_name | varchar | 是 | 版本名称 |
| station | varchar | 否 | 站点 |
| status | enum | 是 | draft/published/archived |
| created_by | uuid | 否 | 创建人 |
| published_by | uuid | 否 | 发布人 |
| published_at | timestamptz | 否 | 发布时间 |
| created_at | timestamptz | 是 | 创建时间 |
| updated_at | timestamptz | 是 | 更新时间 |

用途：管理预测草稿、发布和归档。

#### forecast_accuracy_monthly（预测准确率）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | 是 | 主键 |
| sku_id | uuid | 是 | SKU 外键 |
| station | varchar | 是 | 站点 |
| platform | varchar | 是 | 平台 |
| forecast_year | integer | 是 | 年份 |
| month | integer | 是 | 月份 |
| forecast_daily_avg | numeric | 是 | 预测日均 |
| actual_daily_avg | numeric | 是 | 实际日均 |
| bias_rate | numeric | 否 | 偏差率 |
| mape | numeric | 否 | 平均绝对百分比误差 |
| version_id | uuid | 否 | 预测版本 |
| computed_at | timestamptz | 是 | 计算时间 |

用途：每月回看预测效果，并将高偏差 SKU 推入下一轮复核。

### 建议新增表

#### sales_forecast_source_batches（预测数据源批次）

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | uuid | 是 | 是 | 主键 |
| batch_no | varchar(50) | 是 | 是 | 批次号 |
| daily_file_name | varchar(255) | 否 | 否 | 每日销量文件名 |
| monthly_file_name | varchar(255) | 否 | 否 | 月度销量文件名 |
| daily_start_date | date | 否 | 否 | 每日数据起始日 |
| daily_end_date | date | 否 | 否 | 每日数据截止日 |
| monthly_start_month | varchar(7) | 否 | 否 | 月度数据起始月 |
| monthly_end_month | varchar(7) | 否 | 否 | 月度数据截止月 |
| sku_count | integer | 是 | 否 | SKU 数 |
| row_count | integer | 是 | 否 | 原始行数 |
| status | enum | 是 | 否 | uploaded/parsed/generated/failed |
| created_by | uuid | 否 | 否 | 上传人 |
| created_at | timestamptz | 是 | 否 | 创建时间 |

用途：记录销量预测使用的原始数据批次，便于追溯。

#### sales_forecast_review_items（预测复核清单）

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | uuid | 是 | 是 | 主键 |
| version_id | uuid | 是 | 否 | 预测版本 |
| sku_id | uuid | 是 | 否 | SKU 外键 |
| station | varchar(20) | 是 | 否 | 站点 |
| platform | varchar(50) | 是 | 否 | 平台 |
| issue_type | enum | 是 | 否 | high_value/trend_shift/stockout_suspected/category_deviation/low_accuracy |
| severity | enum | 是 | 否 | critical/warning/info |
| message | text | 是 | 否 | 复核说明 |
| suggested_daily_avg | numeric | 否 | 否 | 系统建议日均 |
| reviewed_daily_avg | numeric | 否 | 否 | 运营复核后日均 |
| status | enum | 是 | 否 | pending/reviewed/ignored |
| reviewer_id | uuid | 否 | 否 | 复核人 |
| reviewed_at | timestamptz | 否 | 否 | 复核时间 |
| created_at | timestamptz | 是 | 否 | 创建时间 |

用途：把 6000+ SKU 缩小为运营需要处理的风险清单。

#### sales_forecast_seasonality（品类/项目组季节性）

| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | uuid | 是 | 是 | 主键 |
| dimension_type | enum | 是 | 否 | category/project_group |
| dimension_value | varchar(200) | 是 | 否 | 品类或项目组 |
| month | integer | 是 | 否 | 月份 |
| seasonality_factor | numeric | 是 | 否 | 季节性系数 |
| trend_factor | numeric | 否 | 否 | 近期趋势系数 |
| source_batch_id | uuid | 否 | 否 | 来源批次 |
| updated_at | timestamptz | 是 | 否 | 更新时间 |

用途：把月度项目组/品类表转成趋势校验与预测修正因子。

## 3. 页面流程

### 页面清单

| 页面 | 路由 | 功能 |
|------|------|------|
| 销量预测工作台 | /sales-forecast | 汇总版本、导入批次、预测状态、风险数量 |
| 数据上传与诊断 | /sales-forecast/import | 上传两份表、展示解析结果、未匹配 SKU |
| 预测生成 | /sales-forecast/generate | 选择预测起点、范围、粒度，生成草稿 |
| 复核清单 | /sales-forecast/review | 查看异常 SKU、批量调整、填写原因 |
| 预测明细 | /sales-forecast/detail | 按 SKU/站点/平台/月查看预测日均 |
| 版本管理 | /sales-forecast/versions | 草稿、发布、归档、校验 |
| 准确率分析 | /sales-forecast/accuracy | MAPE、偏差率、高偏差 SKU |
| 趋势看板 | /sales-forecast/trends | 项目组/品类/月度趋势 |

### 主流程

1. 运营进入「数据上传与诊断」。
2. 上传每日 SKU 销量表和月度项目组/品类销量表。
3. 系统解析并展示数据诊断：时间范围、SKU 数、平台分布、缺失、异常、未匹配 SKU。
4. 运营确认后，系统生成预测草稿版本。
5. 系统生成复核清单，运营优先处理 critical 和 warning。
6. 运营调整预测日均、原因、置信度、生命周期。
7. 系统校验版本是否覆盖未来补货周期。
8. 运营或管理员发布版本。
9. 补货任务读取已发布版本，计算补货建议。
10. 每月初系统计算上月准确率，高偏差 SKU 进入下一轮复核。

### 页面关键交互

#### 数据上传与诊断

- 支持分别上传每日表和月度表。
- 文件上传后仅记录文件名、范围、批次，不把原始业务文件提交到 Git。
- 每日表宽表转长表：日期列 `(YYYY-MM-DD)` 展开为 `sale_date` 和 `qty_sold`。
- 月度表解析项目组和品类维度，用于趋势系数，不直接作为 SKU 预测结果。
- 诊断项包括：
  - 原始行数、SKU 数、日期范围。
  - 平台和站点分布。
  - 未匹配 SKU。
  - 长时间 0 销量区间。
  - 异常峰值。
  - 月度表覆盖月份与最近月份。

#### 预测生成

- 默认预测起点为当前月下一个完整月份。
- 默认生成未来 12 个月。
- 默认粒度为 `SKU + station + platform`。
- 可选择是否将平台合并为 `ALL`。
- 生成后写入草稿版本，不直接覆盖已发布版本。

#### 复核清单

- 默认只展示需要运营处理的 SKU。
- 支持按严重程度、品类、项目组、平台、负责人过滤。
- 支持单 SKU 查看历史销量曲线、基线预测、月度趋势、准确率。
- 支持批量确认系统建议。
- 所有人工调整必须填写原因。

#### 版本管理

- 一个站点同时只允许一个 primary published 版本参与补货。
- 发布前校验：
  - 未来补货周期所需月份是否覆盖。
  - 同 SKU+站点+月份是否混用 `ALL` 与分平台。
  - 预测日均是否为负数或异常极值。
  - critical 复核项是否已处理。

## 4. 预测规则

### 预测输出口径

预测输出为月度日均销量：

```text
forecast_daily_avg = 该 SKU 在该站点/平台/月份预计每天销售数量
```

补货计算使用未来 N 天跨月加权日均，而不是简单使用当前月。

### SKU 生命周期识别

| 生命周期 | 判断规则 | 预测策略 |
|----------|----------|----------|
| 成熟品 | 首单超过 180 天，近 90 天有稳定销量 | 近 90 天、近 30 天、去年同月加权 |
| 增长品 | 近 30 天日均高于近 90 天 30% 以上 | 提高近期权重，提示运营确认 |
| 下滑品 | 近 30 天日均低于近 90 天 30% 以上 | 降低预测，提示是否下架/活动结束 |
| 新品 | 首单不足 90 天 | 近 14/30 天趋势 + 同品类系数 |
| 间歇品 | 销量稀疏，销售日占比低 | 用月均销量，不做过细波动外推 |
| 疑似断货品 | 连续 7 天以上 0 销量后恢复，且历史有稳定销量 | 剔除断货区间后重算基线 |

### 基线预测公式

成熟品默认公式：

```text
baseline_daily_avg =
  recent_90d_daily_avg * 0.50
+ recent_30d_daily_avg * 0.30
+ last_year_same_month_daily_avg * 0.20
```

若缺少去年同月数据：

```text
baseline_daily_avg =
  recent_90d_daily_avg * 0.65
+ recent_30d_daily_avg * 0.35
```

若近 90 天数据不足：

```text
baseline_daily_avg =
  recent_30d_daily_avg * 0.70
+ category_reference_daily_avg * 0.30
```

### 月度趋势修正

月度项目组/品类表不直接预测 SKU，而是生成趋势与季节性因子：

```text
forecast_daily_avg =
  baseline_daily_avg
* seasonality_factor
* trend_factor
* manual_adjustment_factor
```

第一版建议将修正幅度限制在合理范围：

```text
0.70 <= seasonality_factor * trend_factor <= 1.30
```

超过范围时不自动应用，只生成复核项。

### 人工调整规则

- 运营调整后，`manual_daily_avg` 优先于系统基线。
- `forecast_daily_avg` 保存最终生效值。
- 必须记录 `adjust_reason`。
- 置信度可选：
  - high：运营明确知道活动、备货或下架安排。
  - medium：有趋势依据但不确定。
  - low：数据不足或需后续观察。

## 5. 异常规则

### 复核项类型

| 类型 | 触发条件 | 处理建议 |
|------|----------|----------|
| high_value | SKU 近 90 天销量排名 Top N 或贡献额高 | 必须人工确认 |
| trend_shift | 近 30 天日均相比近 90 天变化超过 30% | 检查是否活动、断货、下架 |
| stockout_suspected | 连续 7 天以上 0 销量后恢复 | 剔除断货期或人工修正 |
| category_deviation | SKU 预测趋势与品类/项目组趋势相反 | 运营确认是否个别 SKU 特殊 |
| low_accuracy | 上月 MAPE 超过 30% | 进入重点复盘 |
| missing_history | 历史数据不足 | 用同品类参考，低置信度 |
| platform_mix | 同 SKU+站点+月份混用 ALL 和分平台 | 发布前警告 |

### 严重程度

| 严重程度 | 规则 |
|----------|------|
| critical | 影响补货计算、预测缺失、负数、关键 SKU 未复核 |
| warning | 趋势异常、断货疑似、准确率偏差大 |
| info | 数据不足、低销量、平台别名需确认 |

发布前必须处理 critical；warning 可发布但需记录。

## 6. 自动化任务

### forecastBaselineGenerate

- 触发：运营上传数据后手动触发。
- 输入：每日 SKU 销量长表、月度趋势数据、目标站点、预测起点。
- 输出：草稿版本、预测明细、复核清单。

### forecastAccuracy

- 触发：每月 1 日。
- 输入：上月已发布预测、上月实际销量。
- 输出：准确率记录、高偏差 SKU 复核项。

### replenishmentForecast

- 触发：每周一。
- 输入：已发布预测版本、库存、在途、在产、安全库存策略。
- 输出：补货建议、缺货预警。

## 7. 权限与安全

- 销量原始文件包含真实业务数据，不提交 GitHub。
- 仅运营、管理员可上传销量文件。
- 仅运营、管理员可调整和发布预测。
- 采购/PMC 只能读取已发布预测和补货结果。
- 原始文件建议本地处理或进入受控上传目录，不长期保留敏感源文件。

## 8. 验收标准

### 数据上传

- 可以解析每日 SKU 销量宽表，识别日期列并转为销量历史。
- 可以解析月度项目组/品类表，生成趋势和季节性参考。
- 未匹配 SKU、异常日期、空值、平台别名能在诊断页展示。

### 预测生成

- 可以按 `SKU + station + platform` 生成未来 12 个月预测日均。
- 成熟品、新品、增长品、下滑品、间歇品、疑似断货品能被打标签。
- 草稿生成不会覆盖已发布版本。

### 运营复核

- 可以生成复核清单，并按严重程度排序。
- 运营可调整预测日均、原因、置信度、生命周期。
- critical 项未处理时，发布流程给出阻断或明确确认。

### 发布与补货

- 发布后，补货计算读取已发布版本。
- 分平台预测可以聚合为 SKU+站点需求。
- `ALL` 与分平台混用时有提示，补货按分平台汇总优先。

### 准确率

- 每月可计算预测日均与实际日均。
- 可以展示 MAPE、偏差率、高偏差 SKU。
- 高偏差 SKU 自动进入下一轮复核清单。

## 9. MVP 边界

### 第一版包含

- 两份销量表上传与诊断。
- 每日销量宽表转长表。
- 月度项目组/品类趋势解析。
- SKU 生命周期识别。
- 未来 12 个月基线预测生成。
- 异常复核清单。
- 运营手动调整。
- 预测版本发布。
- 准确率回看。
- 补货联动。

### 第一版不包含

- 黑盒机器学习模型。
- Dify 或外部 AI 自动预测。
- 广告、价格、活动、排名等外部因子。
- 自动采购下单。
- 每日级销量预测。
- 原始销售文件入库长期保存。

## 10. 后续演进

### 第二阶段

- 引入活动日历、价格变动、广告投放、库存断货记录。
- 用断货识别修正真实需求。
- 按品类配置不同预测权重。
- 支持预测版本差异对比。

### 第三阶段

- 引入机器学习模型或 Dify 工作流作为辅助建议。
- 建立品类级预测模型，再分摊到 SKU。
- 根据历史准确率自动调整模型权重。
- 支持运营问答式预测复盘。
