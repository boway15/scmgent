# 周需求近窗：销量延迟 + 对齐月近远窗

**版本**：v1.1（2026-11-04）  
**定位**：月预测继续整月冻结、月中不吃实销；提高近端频率靠周计划。周近窗终点为「业务日 − 延迟天数」与「库内最大销日」取更早者；水位与地平线混合对齐月侧 `recent30/90` 与 `computeHorizonBlendWeights`。  
**关联**：[2026-09-22-planning-horizon-weekly-monthly-design.md](./2026-09-22-planning-horizon-weekly-monthly-design.md)、矩阵运营对齐 [2026-11-04-weekly-demand-matrix-parity.md](./2026-11-04-weekly-demand-matrix-parity.md)

---

## 1. 决策

| 项 | 选择 |
|----|------|
| 月预测当月 MTD | **不做**；生成仍 `effectiveRecentWindowEnd`（未满月截上月末） |
| 周近窗终点 | `D_max = min(业务日 − LAG_DAYS, 可见最大销日)` |
| `LAG_DAYS` | 常量 **2** |
| 周水位 `U` | `U30`/`U90`（同截止 `D_max`）→ `computeNearTermLevel`（默认 mature：0.65×90+0.35×30） |
| 周系统日均 | `near = U×share×shape`，`far = F_w×share`（`F_w≤0` 则 far=near）；`k=⌊weekIndex/4⌋` 复用 `computeHorizonBlendWeights` |
| 回测月预测 | 不变（严格无泄漏） |
| 周计划开始周 | 当周 + 往前 26 周可选；早于当周 → 训练截止开始周周一前一日（严格回测） |
| 表头展示 | ISO 周键仍入库；UI 宽表/长表显示周一 `MM-DD`，悬停见 `YYYY-Www` |
| 不移植 | V4.1 分层、lifecycle decline/new、品类参考注入 |

成功标准：

- 业务日 10-25、库内销到 10-23 → 近窗终点 **10-23**（不是 10-24）。
- 业务日 10-25、库内只到 10-22 → 近窗终点 **10-22**。
- 无销行时终点退回假定截止日（`业务日 − 2`），`U` 仍为 0。
- `weekIndex=0` 近端偏 `U×shape`；`weekIndex≥24`（k≥6）远端偏已发布月插值日均 `F_w`。

---

## 2. API（纯函数）

### 2.1 近窗截止 — `planning-calendar.ts`

```text
PLANNING_SALES_LAG_DAYS = 2
planningAssumedSalesCutoff(asOf, lagDays = 2) → Date
planningRecentWindowEnd(asOf, opts?) → Date
  opts.lagDays?: number
  opts.maxSaleDate?: string|Date
maxSaleDateKey(rows) → string|null
```

旧语义「昨天」= `lagDays: 1`；默认 `2`。

### 2.2 周混合 — `demand-plan-reconstruct.ts`

```text
weekIndexToHorizonMonthIndex(weekIndex) → floor(weekIndex/4)
systemDailyAvgForWeek({ U, share, weekForecastDaily, championRefDaily, weekIndex })
  near = systemDailyAvgForMonth(...)
  far  = weekForecastDaily>0 ? weekForecastDaily*share : near
  { wNear, wYoy } = computeHorizonBlendWeights(k)
  return wNear*near + wYoy*far
```

无月形状时：`F_w = U`，shape=1，26 周仍为 `U×share`。

---

## 3. 接入点

| 位置 | 改动 |
|------|------|
| `generateDemandPlanDraft` | 假定截止加载 → `maxSaleDate` 收紧 `windowEnd`；对每 SKU 算 U30/U90 → `U`；按 `weekIndex` 写 `system_daily_avg`；`unconstrained_recent_daily` 存合成 `U` |
| `loadDemandPlanSkuDetail` | 近窗展示同样用 lag + 最大销日 |

`source` 仍按 **90 窗**还原的 `inStockDays` 分类。

---

## 4. 非目标

- 不改月预测生成 / 当月入库日均公式。
- 不改 26 周地平线、采用位语义。
- 不把 `LAG_DAYS` 做成环境变量。

---

## 5. 测试

- `planningRecentWindowEnd`：lag=2；`maxSaleDate` 取 min。
- `weekIndexToHorizonMonthIndex`；`systemDailyAvgForWeek` 近端/远端权重与 `F_w=0` 回退。
