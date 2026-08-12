# T4B / T99 温和乐观放宽（方案 A）

> **状态**：已批准设计  
> **日期**：2026-08-12  
> **目标**：缓解分层复盘中 T4B / T99 系统性总量低估；先做温和抬系数，离线 7 月复盘后再决定是否加方案 B（漏报闸）。

---

## 1. 背景与决策

分层准确率（全期有符号 MAPE）显示尾部两层明显低估：

| 分层 | 现象（示例复盘） | 根因（设计使然） |
|------|------------------|------------------|
| T4B | 预测约 22.1 万 vs 实际 36.5 万，约 **-39%** | 保守系数 0.6/0.8 + recent 上界压低 + flex 衰减 |
| T99 | 预测约 9.6 万 vs 实际 21.6 万，约 **-56%** | `max(r30,r90)×0.6` + `r30≤0→0` |

**决策**

| 决策项 | 结论 |
|--------|------|
| 范围 | **T4B + T99** 一起放宽（用户选择） |
| 本轮方案 | **方案 A：温和抬系数**；不改分层规则、不改 Ghost / T99 断销闸 |
| 后续 | 7 月离线复盘后，若 T99 漏报（系统=0 有实际）仍过大，再开 **方案 B** |
| 生效范围 | **仅新生成预测版本**；不强制重算已 published 历史版本 |
| 主 KPI | 仍排除 T4B / T99（`excludedFromMainStats`） |
| T1–T4A | **不改**公式与常量 |

成功标准（相对当前同口径复盘）：

1. T4B、T99 **有符号总量偏差** 各至少改善约 **10～15 个百分点**（不要求一次打到 0）。
2. T1–T4A 主 KPI 基本不变。
3. Ghost「系统>0 且实际≈0」行数不明显恶化。

---

## 2. 参数变更（方案 A）

### 2.1 T4B（`forecast-allcat-v41.ts`）

| 常量 | 现 | 新 |
|------|----|----|
| `V41_T4B_NEAR_CONSERVATIVE_FACTOR` | 0.8 | **0.9** |
| `V41_T4B_CONSERVATIVE_FACTOR` | 0.6 | **0.75** |
| `V41_T4B_RECENT30_CAP` | 0.85 | **0.95** |
| `V41_T4B_RECENT90_CAP` | 0.9 | **1.0** |

**本轮不变**

- `V41_T4B_FLEX_DECAY_FROM_K` / `V41_T4B_FLEX_DECAY_FACTOR`（远月 ×0.72）
- `V41_T4B_ANCHOR_CAP` / `V41_T4B_D6_CAP`
- 近端抬底：`V41_T4B_NEAR_BLEND_FLOOR` / `_NEAR_D6_FLOOR` / `_NEAR_RECENT90_FLOOR`
- Ghost 弱动销阈值：`V41_T4_WEAK_*`、`V41_T4_GHOST_TREND_RATIO_MAX` 等

### 2.2 T99（`forecast-demand.ts`）

| 常量 / 默认 | 现 | 新 |
|-------------|----|----|
| `T99_SYSTEM_FLOOR_DISCOUNT` | 0.6 | **0.8** |
| `resolveT99ReplenishmentFallbackDaily` 默认 `discount` | 0.6 | **0.8**（与系统保底对齐） |

**本轮不变**

- 断销闸：`recent30DailyAvg ≤ 0` → 全地平线 `0`（`zero_gate_recent30`）
- 远月衰减：`k ≥ 3` 再 × `0.72`
- `t99FloorMode` 枚举值可保留 `recent_max06` 语义（或后续文档注明「折扣已改为 0.8」；**不强制改枚举名**，避免破坏已落库 factors）

公式（折扣更新后）：

```text
if recent30DailyAvg <= 0:
  forecastDaily = 0
else:
  base = max(recent30, recent90) * 0.8
  forecastDaily = (k >= 3) ? base * 0.72 : base
```

---

## 3. 明确不做（本轮）

- 不放宽 T4 Ghost / 弱动销闸（方案 B 候选）。
- 不把 T99「r30=0 但 r90>0」改为给正保底（方案 B 候选）。
- 不改 T4A 或其他分层常量。
- 不改 UI 文案大范围重写（若有写死「×0.6」的帮助文案，随常量同步一句即可）。
- 不批量调用 Dify；T99 仍以系统保底为主。

---

## 4. 实现面

| 文件 | 改动 |
|------|------|
| `apps/web/server/lib/forecast-allcat-v41.ts` | 更新 T4B 四处常量 |
| `apps/web/server/lib/forecast-demand.ts` | `T99_SYSTEM_FLOOR_DISCOUNT` 与补货 fallback 默认折扣 → 0.8 |
| `apps/web/server/lib/forecast-allcat-v41.test.ts` 等 | 更新依赖旧常量的断言 |
| `apps/web/server/lib` 内 T99 相关单测 | 断言折扣 0.8 / 远月衰减结果 |
| 前端帮助文案（若有硬编码 0.6） | 与新折扣对齐 |
| `apps/web/scripts/validate-july-t4b-relax.ts` | 复用/小扩展，输出 T4B+T99 旧 vs 新偏差；**不写库** |

数据流：仅影响下一次 V4.1 批量生成写入的 `forecast_daily_avg` / `horizon_factors`；已发布版本矩阵不变。

---

## 5. 验证

1. 单元测试：T4B 近端/远月 conservativeFactor、上界 cap；T99 `resolveT99SystemFloorDaily` 折扣与断销闸。
2. 离线复盘：对已 published 的 2026-07 行，用新常量重算系统日均，对比实际销量，分层输出有符号偏差 / WMAPE。
3. 人工抽查：若干 T4B 近端、T99 有动销、T99 断销（仍应为 0）样例。

复盘通过且达标 → 结束本轮。  
T99 漏报仍主导总量差 → 另开方案 B 设计（漏报闸），不在本 spec 扩 scope。

---

## 6. 风险与回滚

| 风险 | 缓解 |
|------|------|
| Ghost 高估略增 | 本轮不松闸；验收看「有预测无实际」行数 |
| 补货水位上移 | T99/T4B 折扣同步提高，属预期；可用旧常量一键回滚 |
| 历史版本不可比 | 文档标明「新版本生效」；复盘脚本标注常量版本 |

回滚：将上表常量恢复为「现」列并重新生成版本即可。
