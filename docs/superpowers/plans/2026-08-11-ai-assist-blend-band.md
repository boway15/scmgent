# AI 辅助 ±10% 收敛带 Implementation Plan

> **For agentic workers:** 按任务顺序执行；每任务测过后提交。  
> **Spec:** `docs/superpowers/specs/2026-08-11-ai-assist-blend-band-design.md`

## 文件

| 文件 | 职责 |
|------|------|
| `apps/web/server/lib/forecast-ai-assist-reference.ts` | ε、对称 clamp、resolve |
| `apps/web/server/lib/forecast-ai-assist-reference.test.ts` | 单测 |
| `apps/web/server/lib/forecast-dify-single.ts` | 传入 hasExogenous |
| `docs/dify/workflows/single-sku-forecast.yml` | Prompt 写明 ±10% |
| `apps/web/src/components/ForecastAssistPanel.tsx` | 成功提示一句 |

## 任务

1. TDD：带宽 clamp + exogenous ε=0.12 + fallback  
2. 接线 `runDifySingleSkuForecast`  
3. DSL / FE 文案  
4. 更新 spec 状态为已实现  
