# 销售预测精度达标方案：1–3 月 ≤15%、3–6 月 ≤25%

> **状态**：草案，基于走步回测数据分析  
> **日期**：2026-07-02  
> **前置**：[2026-06-30-forecast-v2-optimization-design.md](./2026-06-30-forecast-v2-optimization-design.md)  
> **数据依据**：`asOf=2026-01-01`、6 个月、US/ALL，v2/v3 走步 CSV（2,919 SKU，17,514 行）

---

## 1. 执行摘要

**结论：当前 v2/v3 算法无法在全库或主力 SKU 层面达到 15%/25%，但通过「范围收窄 + 分类路由 + 近月校准」四阶段组合，可在 12 周内将验收口径下的 KPI 推进至目标附近。**

| 指标 | v2 现状 | v3 现状 | 目标 | 差距 (v3 主力 k=0~2) |
|------|---------|---------|------|----------------------|
| k=0~2 全量 WMAPE | 65.3% | **53.4%** | ≤15% | −38.4pp |
| k=3~5 全量 WMAPE | 73.7% | **53.8%** | ≤25% | −28.8pp |
| k=0~2 主力 WMAPE | 50.9% | **42.3%** | ≤15% | −27.3pp |
| k=3~5 主力 WMAPE | 66.5% | **45.3%** | ≤25% | −20.3pp |
| 主力 SKU 达标率 (k=0~2) | 6.0% | **11.0%** | ≥80% | — |

**核心判断**：目标在业务上合理，但**不能**用「单一启发式公式 + 全 SKU 点预测」达成；必须改为 **按决策窗口 × ABCD 分类 × 人工协同** 的分层体系。

---

## 2. 数据分析结论

### 2.1 分析命令（可复现）

```bash
# 决策窗口 × 销量分层
pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-horizon-bands.ts

# ABCD 分类模拟（6 月口径）
pnpm --filter @scm/web exec tsx scripts/analyze-walkforward-abcd.ts
```

### 2.2 误差归因（v3，k=0~2）

| 归因 | 行数占比 | 对 WMAPE 的影响 | 优先处理 |
|------|----------|-----------------|----------|
| 零实际仍预测 >0 | **37.6%** | 长尾/D 类噪音，拉高全库 KPI | P0 |
| 可比行低估 (\|bias\|>15%) | **49.9%** | v3 cap 后从高估转为低估为主 | P1 |
| 可比行高估 (\|bias\|>15%) | 34.5% | 季节×趋势叠加 | P1 |
| 主力 SKU 中位 WMAPE (k=0~2) | P50 **39.4%** | 即使头部 SKU 也不达标 | P2 |

### 2.3 ABCD 分类模拟（v3，6 月口径）

| 类 | SKU 数 | k=0~2 主力 WMAPE | k=3~5 主力 WMAPE | 说明 |
|----|--------|------------------|------------------|------|
| **A 常青** | 1,255 (主力 276) | **42.6%** | **45.0%** | 唯一值得追 15%/25% 的池子 |
| B 爆款 | 42 | — | — | 无主力 SKU，需事件模型 |
| C 长尾 | 381 | 27.4%* | — | *仅 5 个主力，样本过小 |
| D 问题 | 1,241 | 55.5%* | — | *仅 2 个主力，应退出 KPI |

**关键发现**：即便在 A 类 × 主力 SKU 子集，k=0~2 WMAPE 仍为 **42.6%**，说明 v2 公式对「连续稳定款」也有系统性偏差，需要独立 A 类通道（时序模型或强约束近月锚定）。

### 2.4 单 SKU 标杆（DJ502530_2，主力常青）

| 窗口 | v3 WMAPE | 目标 |
|------|----------|------|
| k=0~2 | ~20.2% | ≤15% |
| k=3~5 | ~44.0% | ≤25% |

cap 有效压近月高估，但远月仍超目标约 20pp。

---

## 3. 目标定义（验收口径）

### 3.1 分层 KPI（正式验收只用此口径）

**不再使用全库 WMAPE 作为发布门禁。**

| 验收层 | 条件 | k=0~2 目标 | k=3~5 目标 | k=6~11 目标 |
|--------|------|------------|------------|-------------|
| **A 类 · 主力** | continuity>75%, CV<1, 均实际≥5/日 | **WMAPE ≤15%** | **WMAPE ≤25%** | ≤35% |
| **A 类 · 腰部** | 同上，1–5/日 | ≤20% | ≤30% | ≤40% |
| **B 类** | continuity>75%, CV≥1 | 点预测≤20% + **P10–P90 覆盖率≥70%** | ≤25% + 覆盖率 | 区间为主 |
| **C 类** | 汇总分解 | **品类池** WMAPE ≤20% | ≤25% | ≤35% |
| **D 类** | floor 管理 | **不考核准确率**，考核风险暴露 | 同左 | 同左 |

### 3.2 指标公式（与现有一致）

- **WMAPE** = Σ\|forecast − actual\| / Σ(actual)，仅 actual > 0
- **bias_rate** = (actual − forecast) / forecast
- **horizon_band**：k=0~2 → `precision`；k=3~5 → `flex`；k=6~11 → `strategic`

### 3.3 走步回测固定参数

- `asOf=2026-01-01`，`monthCount=12`（扩展至 12 月验收 k=6~11）
- 每月滚动复跑，取最近 4 个 asOf 的均值作为发布前验收

---

## 4. 根因 → 对策映射

```
                    ┌─────────────────────────────────────┐
  37.6% 零实际预测  │ P0: D类 floor / 退出可比集           │ → 全库 WMAPE −15~20pp
                    └─────────────────────────────────────┘
                    ┌─────────────────────────────────────┐
  A类主力仍 42.6%   │ P1: A类近月锚定 + 15/25 bias cap    │ → A主力 k=0~2 −15~20pp
                    └─────────────────────────────────────┘
                    ┌─────────────────────────────────────┐
  49.9% 低估        │ P2: 双向校准 + 运营 override k=0~2  │ → A主力 k=0~2 −8~12pp
                    └─────────────────────────────────────┘
                    ┌─────────────────────────────────────┐
  B类高波动         │ P3: Prophet + 大促日历 + 区间       │ → B类 3~6月 ≤25%
                    └─────────────────────────────────────┘
                    ┌─────────────────────────────────────┐
  C类 981 tail SKU  │ P1: 品类汇总 → 占比分解             │ → tail 退出 SKU 级 KPI
                    └─────────────────────────────────────┘
```

---

## 5. 分阶段实施方案

### Phase 0：度量基础（1 周）

**目标**：能回答「1–3 月是否 ≤15%」，不再被全库 MAPE 误导。

| 交付 | 文件 |
|------|------|
| `forecast-horizon-band.ts`：`horizonBandFromIndex(k)`、`summarizeAccuracyByHorizonBand()` | 新建 |
| 走步回测返回 `horizonBandSummary` + `profileClassSummary` | `forecast-walkforward-backtest.ts` |
| 准确率 Tab：窗口 × 分层热力图 | `ForecastAccuracyTierSummary.tsx` 扩展 |
| CLI | `analyze-walkforward-horizon-bands.ts`（已完成） |

**验收**：页面一键展示 k=0~2 / k=3~5 × core 的 WMAPE，与 CSV 脚本误差 <0.1pp。

---

### Phase 1：范围收窄（2 周）— 预期全库 k=0~2 从 53% → **~30%**

#### 1.1 D 类：下限管理，退出 KPI

```typescript
// forecast-profile-class.ts
export function classifyForecastProfile(input: {
  monthlyQty: number[]; // 近 12 月
}): 'A' | 'B' | 'C' | 'D';

// D 类预测
forecast_daily_avg = min(recent90DailyAvg * 0.5, categoryP25DailyAvg, floorConfig)
// 不乘 seasonality × trend
```

- 准入收紧：`recent90=0 AND recent30=0` → **不生成**（除非 force_forecast）
- D 类写入 `forecast_profile_class='D'`，走步回测 `comparable=false`

#### 1.2 C 类：品类汇总分解

- 汇总维度：`二级品类 + station + platform`
- 品类月预测：近 6 月品类 WMAPE 加权趋势（或项目组月表）
- SKU 分解：`sku_forecast = category_forecast × sku_share_6m`
- KPI 只在品类池层验收

#### 1.3 零销 SKU 止血

- 回测可比集排除：`6 个月 actual 全为 0` 的 SKU（当前 683 个，23.4%）
- 预期消除 37.6% 的 ghost forecast 行

**Phase 1 后预期**（模拟）：

| 口径 | WMAPE k=0~2 |
|------|-------------|
| 全库（仅 A+B 可比） | ~35% |
| A 类主力 | ~38% |

---

### Phase 2：A 类算法通道（3 周）— 预期 A 主力 k=0~2 从 42% → **~18%**

#### 2.1 近月强锚定（k=0~2）

对 `profile_class='A'` 且 `lifecycle in (mature, decline)`：

```text
k=0: forecast = 0.70 × recent30 + 0.30 × recent90  （禁 season×trend 放大）
k=1: forecast = 0.55 × recent30 + 0.45 × recent90
k=2: forecast = 0.40 × near + 0.60 × yoy_month_level × clip(growth, 0.9~1.1)
```

- 季节系数：A 类 k=0~2 限制 `|season×trend − 1| ≤ 0.10`
- 目标：DJ502530_2 类 SKU k=0~2 从 20% → **~12%**

#### 2.2 偏差预算对齐业务目标

```typescript
// forecast-baseline.ts 调整
HORIZON_BIAS_BUDGET_NEAR = 0.15;  // 原 0.20
HORIZON_BIAS_BUDGET_FAR = 0.25;   // 原 0.35
```

- cap 扩展至 **双向**：`|forecast − anchor| / anchor ≤ budget`（对称区间，非仅高估封顶）
- 仅 A 类主力启用双向 cap

#### 2.3 远月衰减（k=3~5）

```text
k=3~5: baseline = w_yoy × structural_level，w_yoy ≥ 0.75
       forecast = baseline × clip(season×trend, 0.85~1.15)
```

**Phase 2 后预期**：

| 口径 | k=0~2 | k=3~5 |
|------|-------|-------|
| A 主力 | **~16%** | **~24%** |
| A 主力达标 SKU 占比 | ~55% | ~60% |

---

### Phase 3：运营协同闭环（2 周）— 预期 A 主力 k=0~2 从 ~18% → **~13%**

#### 3.1 强制复核范围（仅 k=0~2）

| 条件 | 动作 |
|------|------|
| A 类 + 主力 + k=0~2 | 每月发布前 **Top 50 销量 SKU 必须人工确认或采纳系统值** |
| \|bias\| >15% 的 pending review | 阻塞发布（可管理员 override） |
| B 类 k=0~2 | 必须确认大促日历 |

#### 3.2 自动校准建议

- 走步回测偏差 >15% 的 A 类 SKU：生成 `suggested_daily_avg = actual_ema_3m`
- 运营一键采纳：`manual_daily_avg = suggested`

#### 3.3 发布门禁

```text
发布条件（AND）：
  - A类主力 k=0~2 加权 WMAPE（上一版回测）≤ 18%  OR  人工复核率 100%
  - D类不计入
  - C类仅品类池达标
```

**Phase 3 后预期**：A 主力 k=0~2 **~13%**（Top 50 人工 + 其余算法）

---

### Phase 4：B 类事件模型（4 周，可并行）— B 类 k=3~5 ≤25%

| 交付 | 说明 |
|------|------|
| `forecast_promo_calendar` 表 + 维护页 | Prime Day / BFCM / 自定义 |
| B 类 Prophet 或分段回归 | 输出 P10/P50/P90 |
| PMC 3–6 月消费 P90 | 备料上限 |

B 类仅 42 SKU，但对爆款误差的业务影响大；不阻塞 A 类 15% 目标。

---

### Phase 5：下游按窗口消费（2 周）

| 消费方 | k | 字段 |
|--------|---|------|
| 补货 / 快船追货 | 0~2 | `effective_daily` 或 B 类 `p90` |
| PMC 白坯备料 | 3~5 | A 类点预测 ×1.1；B 类 `p90` |
| 海外仓托盘位 | 6~11 | `(p90−p10)/p50` 或 ±40% 带 |

---

## 6. 里程碑与 KPI 演进预测

| 里程碑 | 周次 | A 主力 k=0~2 | A 主力 k=3~5 | 交付 |
|--------|------|--------------|--------------|------|
| M0 基线 | 0 | 42.3% | 45.3% | v3 走步数据 |
| M1 Phase 0 | 1 | 42.3%（可度量） | 45.3% | 窗口 KPI 上线 |
| M2 Phase 1 | 3 | ~38% | ~40% | D/C 路由 |
| M3 Phase 2 | 6 | **~16%** | **~24%** | A 类通道 |
| M4 Phase 3 | 8 | **~13%** | **~22%** | 运营闭环 |
| M5 Phase 4 | 12 | 维持 | B 类 ≤25% | 事件模型 |

> 以上为基于归因的结构化估算，每阶段结束必须走步复跑验证，不达标则不进入下一阶段。

---

## 7. 数据模型变更（最小集）

```sql
-- forecast_profile_class 快照
ALTER TABLE sales_forecast_monthly
  ADD COLUMN IF NOT EXISTS forecast_profile_class varchar(1),
  ADD COLUMN IF NOT EXISTS horizon_band varchar(20),
  ADD COLUMN IF NOT EXISTS forecast_daily_p10 numeric,
  ADD COLUMN IF NOT EXISTS forecast_daily_p90 numeric,
  ADD COLUMN IF NOT EXISTS continuity_12m numeric,
  ADD COLUMN IF NOT EXISTS cv_12m numeric;

CREATE TABLE IF NOT EXISTS forecast_promo_calendar (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_year int NOT NULL,
  event_month int NOT NULL,
  station varchar(20),
  platform varchar(50),
  event_type varchar(50) NOT NULL,
  intensity numeric DEFAULT 1.0,
  confirmed boolean DEFAULT false,
  updated_at timestamptz DEFAULT now()
);
```

---

## 8. 风险与降级

| 风险 | 降级策略 |
|------|----------|
| A 类时序模型训练成本高 | Phase 2 先用「近月强锚定 + 双向 cap」，Prophet 作为 P4 增强 |
| 运营复核 Top 50 人力不足 | 改为 Top 20 + 其余抽样 10% |
| 12 月走步回测数据不足 | 先用 6 月 + 4 个 asOf 滚动 |
| 15% 对 B/D 类不适用 | 验收表已分层，D 不考核 |

---

## 9. 不建议的路径

1. **继续调 v2 全局 season×trend clip** — 全库 WMAPE 已证伪，边际收益 <2pp  
2. **全 SKU 统一 15% 门禁** — 53% 零销/间歇 SKU 必然失败  
3. **仅提高 cap 力度而不收窄范围** — 会导致系统性低估（v3 已出现 49.9% 低估行）  
4. **引入 ML 替代全部 SKU** — 数据稀疏 SKU 会更差；仅 A/B 类值得

---

## 10. 下一步行动（本周）

- [ ] 评审本方案，确认 A 类验收口径与 Phase 1 准入收紧规则  
- [ ] 实现 Phase 0：`summarizeAccuracyByHorizonBand` + API 返回  
- [ ] 走步回测扩展 `monthCount=12`  
- [ ] 启动 Phase 1：`forecast-profile-class.ts` + D 类 floor 分支  
- [ ] 固定 20 个 A 类主力 SKU 作为回归集（含 DJ502530_2）

---

## 附录 A：v2 vs v3 完整对比

| 指标 | v2 | v3 | Δ |
|------|----|----|---|
| k=0~2 全量 WMAPE | 65.3% | 53.4% | −11.9pp |
| k=3~5 全量 WMAPE | 73.7% | 53.8% | −19.9pp |
| k=0~2 主力 WMAPE | 50.9% | 42.3% | −8.6pp |
| k=3~5 主力 WMAPE | 66.5% | 45.3% | −21.2pp |
| 主力 k=0~2 达标率 | 6.0% | 11.0% | +5.0pp |

v3（偏差预算 cap）对**远月**改善显著，但距 15%/25% 仍差 27pp / 20pp（主力近月/远月）。

## 附录 B：分析脚本

| 脚本 | 用途 |
|------|------|
| `apps/web/scripts/analyze-walkforward-horizon-bands.ts` | 窗口 × 分层 WMAPE |
| `apps/web/scripts/analyze-walkforward-abcd.ts` | ABCD 分类模拟 |
| `apps/web/scripts/analyze-walkforward-csv.ts` | 原有分层 + Top 偏差 SKU |
