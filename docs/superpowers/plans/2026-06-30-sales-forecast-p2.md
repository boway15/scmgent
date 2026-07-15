# 销量预测 P2 迭代计划

> 承接 P0/P1 落地（月宽表解析、日/月校验、文件上传诊断、基线增强、高销量复核）后的下一阶段迭代。
> 设计基线：[2026-06-29-sales-forecast-collaboration-design.md](../specs/2026-06-29-sales-forecast-collaboration-design.md)

## 1. P2 目标

在 P1 已具备「可导入、可诊断、可生成 12 个月有形状基线」的前提下，P2 聚焦三件事：

1. **运营效率**：按品类/项目组分批生成与复核，减少全量 SKU 噪音。
2. **预测质量**：引入 ABC 分层权重与准确率闭环，让复核资源投向高影响 SKU。
3. **业务联动**：预测版本与补货、PMC、经营看板形成稳定消费契约。

## 2. 范围总览

| 优先级 | 主题 | 产出 | 依赖 |
|:---:|---|---|---|
| P2-1 | 品类维度运营闭环 | 品类筛选生成、品类复核视图、品类准确率汇总 | P1 品类字段与下拉（本次） |
| P2-2 | ABC 分层权重 | SKU 分层表 + 基线加权 + 复核配额 | 历史销量 + 月表 |
| P2-3 | 准确率驱动复核 | 低准确率自动复核项、月度复盘任务 | `forecast_accuracy_monthly` |
| P2-4 | 日/月偏差运营化 | `daily_monthly_mismatch` 复核项自动入库 | `reconciliation` |
| P2-5 | 预测版本契约 | 发布校验、补货读取契约测试、版本回滚 | `forecast-demand.ts` |
| P2-6 | 经营看板 | 品类/项目组趋势页与导出 | 季节性系数表 |
| P2-7 | 平台与站点治理 | 平台别名维护 UI、站点-仓映射可视化 | `sales_platforms` |

不在 P2：ML 模型、Dify 对话式调整、导入中心长表格式改造。

## 3. 详细任务

### P2-1 品类维度运营闭环（2 周）

**背景**：运营常按品类分工，需要「只生成 Patio / Outdoor」并独立发布版本。

| 任务 | 说明 |
|---|---|
| 版本元数据 | `sales_forecast_versions` 增加 `category`、`platform` 快照字段 |
| 品类生成 | 已完成：`generate-baseline` 支持 `category` 过滤 |
| 品类复核页 | 复核清单默认按品类筛选；显示品类负责人（来自 SKU owner 或配置表） |
| 品类准确率 | `GET /sales-forecasts/accuracy?category=` 聚合 MAPE / bias |
| 发布门禁 | 发布前校验：品类内 Top SKU 必须已复核或忽略 |

**验收**：选择品类 `Outdoor/Patio` 生成 → 仅该品类 SKU 有预测行 → 发布后补货仅读该版本（若配置为品类版本）。

### P2-2 ABC 分层权重（1.5 周）

**公式建议**（可配置）：

```text
weight(A) = 1.0, weight(B) = 0.85, weight(C) = 0.7
baseline_daily_avg_weighted = baseline_daily_avg * abc_weight
```

| 任务 | 说明 |
|---|---|
| 分层计算任务 | 按月滚动计算 `recent90` 销售额占比，写入 `sku_abc_tier` |
| 基线接入 | `computeBaselineDailyAvg` 可选应用 ABC 权重（仅影响低置信 SKU） |
| 复核配额 | A 类 100% 进入高价值复核；B 类 Top 30%；C 类仅异常 |

**验收**：A 类 SKU 预测变更后，补货建议变化幅度 > B/C 类（同销量级）。

### P2-3 准确率驱动复核（1 周）

| 任务 | 说明 |
|---|---|
| 月结任务 | 每月 1 日对上月已发布版本跑 `computeForecastAccuracyBacktest` |
| 自动复核 | MAPE > 40% 且月销 ≥ 30 → `low_accuracy` 复核项 |
| 复盘页 | 准确率 Tab 支持按 SKU/品类钻取、对比基线 vs 人工调整 |

### P2-4 日/月偏差运营化（0.5 周）

| 任务 | 说明 |
|---|---|
| 复核项入库 | 诊断 `reconciliation.topMismatches` 中差额 >5% 写入 `daily_monthly_mismatch` |
| 数据修复流 | 运营可选择「以日表为准」或「以月表为准」触发重聚合 |

### P2-5 预测版本契约（1 周）

| 任务 | 说明 |
|---|---|
| 发布校验增强 | 阻塞：无历史、平台混用、未处理 critical 复核 |
| 补货契约测试 | 集成测试：发布 → `calcForwardAvgDaily` 逐月非平坦 |
| 版本回滚 | 归档当前发布版，一键恢复上一发布版 |

### P2-6 经营看板（1 周）

| 任务 | 说明 |
|---|---|
| 趋势页增强 | 项目组/品类 YoY、MoM 图表（复用 `sales_forecast_seasonality`） |
| 导出 | 品类 × 月份预测 vs 实际 CSV |
| 权限 | 管理者只读；运营可下钻 SKU |

### P2-7 平台与站点治理（0.5 周）

| 任务 | 说明 |
|---|---|
| 平台别名 UI | 维护 `sales_platform_aliases` |
| 站点列表 | 已完成：`GET /sales-forecast/stations` |
| 仓站映射 | 仓库 `region_group` 与预测站点一致性检查 |

## 4. 数据模型变更（P2 汇总）

```sql
-- P2-1
ALTER TABLE sales_forecast_versions
  ADD COLUMN IF NOT EXISTS category varchar(200),
  ADD COLUMN IF NOT EXISTS platform varchar(50);

-- P2-2
CREATE TABLE IF NOT EXISTS sku_abc_tier (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id uuid NOT NULL REFERENCES skus(id),
  station varchar(20) NOT NULL,
  tier char(1) NOT NULL, -- A/B/C
  recent90_revenue numeric(14,2),
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sku_id, station)
);
```

## 5. 里程碑

| 阶段 | 时间 | 交付 |
|---|---|---|
| M1 | 第 1-2 周 | P2-1 品类版本 + 复核筛选 + 准确率按品类 |
| M2 | 第 3-4 周 | P2-2 ABC 权重 + P2-3 准确率月结 |
| M3 | 第 5 周 | P2-4 偏差复核 + P2-5 发布契约 |
| M4 | 第 6 周 | P2-6 看板 + P2-7 平台治理 + 妙搭同步 |

## 6. 验证清单

- [ ] 品类过滤生成：SKU 数 = 商品主数据该品类活跃 SKU 数
- [ ] 历史销量列表/导出含 `category`，且与 SKU 主数据一致
- [ ] 发布版本后补货任务读取逐月 `forecast_daily_avg`
- [ ] ABC 分层后复核量 ≤ 全量 20%
- [ ] 上月 MAPE Top 20 SKU 自动进入复核清单

## 7. 与本次已实现能力的衔接

| 本次（P1 延伸） | P2 承接 |
|---|---|
| `sales_history.category` 快照 | 历史页筛选、品类准确率、ABC 分层输入 |
| 生成预测品类下拉 | 品类版本元数据、分品类发布 |
| 站点/平台下拉 | 站点治理、分平台准确率 |
| `reconciliation` 诊断 | P2-4 自动复核项 |
| YoY 季节性系数 | P2-6 经营看板趋势 |
