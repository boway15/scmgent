# AI 辅助预测：Dify 出数 + 建议水位 ±10% 收敛带

> **状态**：已实现  
> **日期**：2026-08-11  
> **目标**：Dify 继续输出每月预测日均；服务端将其收敛到 `suggestedBlendDaily` 的 ±10% 内，使回测误差可控、可复现，并避免近端高点漂数。

---

## 1. 背景与决策

| 决策项 | 结论 |
|--------|------|
| Dify 是否出数 | **是**，仍输出 `forecastDailyAvg` / confidence / rationale |
| 回测优先 | 最终写入值须贴近服务端 `suggestedBlendDaily` |
| 收敛带 ε | **10%**：`[suggested×0.9, suggested×1.1]` |
| Dify 失败 | 回退为 `suggestedBlendDaily`（沿用现有逻辑） |
| 外生因素 | 本阶段：有 exogenous 时 ε 放宽至 **12%**；无则 10% |
| 非范围 | 不改 V4.1 批量主路径；不改 `sales-forecast-agent.yml`；不做准确率大盘落库 |

此前纯 Prompt / 仅上限封顶仍会出现淡季月被近端带高（如 5 月）；纯「忽略 Dify 数字」不符合「仍出数」期望。本方案为折中：**LLM 出数 + 服务端窄带收敛**。

---

## 2. 服务端

**入口**：`runDifySingleSkuForecast`（既有 AI 辅助链路）。

### 2.1 参考水位（不变）

继续 `buildAiAssistSystemReference` → 每月 `suggestedBlendDaily` / `blendMode`，并下发 `system_reference_json`。

### 2.2 月值解析与收敛

对地平线内每月：

1. 解析 Dify `forecastDailyAvg`（若有）。  
2. 若缺失或 ≤0 → `final = suggestedBlendDaily`（fallback）。  
3. 若有有效 Dify 值且 `suggested > 0`：  
   ```
   lo = suggested * (1 - ε)
   hi = suggested * (1 + ε)
   final = clamp(difyDaily, lo, hi)
   ```  
   - 默认 `ε = 0.10`  
   - 当 `exogenousFactors.factors` 非空时 `ε = 0.12`  
4. `suggested ≤ 0` 时：保持现有行为（采用经护栏后的 Dify 值，或不写）。

实现建议：扩展 `resolveAiAssistMonthDaily` / `applyAiAssistForecastGuard`，将「仅上限」改为「对称带宽 clamp」，并返回是否 fallback / 是否被 clamp。

### 2.3 写入与缺失月

- 写入字段仍为 AI 路径：`forecastModel = dify_single_sku`，profileSegment 等不变。  
- `missingMonths`：仅当最终 `final ≤ 0`（无 suggested 且无 Dify）时计入。  
- rationale：优先 Dify；fallback 时用服务端默认说明（含 blendMode）。

### 2.4 可复现性

同一 `versionId` / `startMonth` / 历史截断下：

- 若 Dify 每次不同，只要落在带宽外，写入值会被拉回边界 → 生效值方差有上界。  
- 若 Dify 失败，两次运行生效值应完全一致（纯 suggested）。

---

## 3. Dify DSL

文件：`docs/dify/workflows/single-sku-forecast.yml`。

- **仍要求**输出 JSON 数组（含 `forecastDailyAvg`）。  
- Prompt 明确：以 `suggestedBlendDaily` 为锚，默认偏离不超过约 10%；服务端会硬 clamp。  
- 保留 `format_json` 增强解析；解析失败由服务端 fallback，不阻断。

用户需在 Dify **重导 DSL** 后 Prompt 才生效；数值正确性不唯依赖重导（服务端带宽兜底）。

---

## 4. 前端（可选、小改）

- AI 成功提示可附一句：`数量已收敛至系统建议水位 ±10%`（有 exogenous 时写 ±12%）。  
- 非必须；以服务端行为为准。

---

## 5. 测试与验收

**单测**

- `dify` 在带宽内 → 原样（经 round）。  
- `dify` 高于 `suggested×1.1` → 等于 `suggested×1.1`。  
- `dify` 低于 `suggested×0.9` → 等于 `suggested×0.9`。  
- `dify` 缺失 → `suggested`，`usedFallback=true`。  
- 有 exogenous → ε=0.12。

**手工**

- DJ502512_13（或同类）开始月回测：生效值不得远离当月 `suggestedBlend`；淡季月不应再贴近近 30 日高点。  
- Dify 返回 `monthly_forecast_json=[]` 时仍能写入满地平线。

---

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 带宽过紧压制合理外生 | 有 exogenous 时 ε=12%；后续可按 factor 类型再分档 |
| suggested 本身偏差 | 继续迭代 `suggestBlendDaily`；与本带宽正交 |
| 用户以为「AI 原值未改」 | 文案说明已收敛；rationale 可保留 Dify 原意 |
