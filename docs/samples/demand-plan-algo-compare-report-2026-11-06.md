# 周预测 v41_inline vs v41_w 离线对比（本机 scm_dev）

**执行时间**：2026-11-06  
**命令**：`pnpm demand-plan:compare-algo`（开始周默认 ≈ 当前 −26 周 → `2026-W19`）

## 汇总

| 样本 | 有可比 SKU | 近 4 周 WMAPE inline | 近 4 周 WMAPE v41_w | 全可比周 WMAPE inline | 全可比周 WMAPE v41_w |
|------|------------|----------------------|---------------------|------------------------|----------------------|
| 150 SKU | 11 | 256.33% | 282.18% | 148.87% | 148.52% |
| 500 SKU | 56 | **168.40%** | 197.68% | **106.72%** | 110.79% |

可比点 = 计划开始周起、已有完整 ISO 周实销且两算法均有系统预测的行。

## 结论（当前库）

- **近端（4 周）**：`v41_inline` 明显优于 `v41_w`（168% vs 198% @500 SKU）。
- **全可比周**：两者接近，`v41_inline` 略优（107% vs 111%）。
- **生产默认**：维持 `DEMAND_PLAN_WEEKLY_ALGO=v41_inline`（或未设置），**暂不切换** `v41_w`。

## 近端混合（near_blend，同一次 500 SKU）

同一可比点上，前 4 周向截止生成近窗的日历 r14/U 混合（无库存序列）：

| 指标 | inline | near_blend | v41_w |
|------|--------|------------|-------|
| 近 4 周 WMAPE | 168.40% | **108.90%** | 197.68% |
| 全可比周 WMAPE | 106.72% | **97.72%** | 110.79% |

近 4 周与全周都优于纯拆周，因此默认 `v41_inline` 生成已接入该混合（`demand-plan-near-blend.ts`）。已有草稿需重新生成后才变。线上生成会用缺货还原后的 r14，离线对比用的是日历日均近似。

## 后续

- 调门槛 / 季节 / 样本扩大后再跑：`pnpm demand-plan:compare-algo -- --max-skus 2000 --csv docs/samples/demand-plan-algo-compare.csv`
- 若仍要试 UI：`.env` 设 `DEMAND_PLAN_WEEKLY_ALGO=v41_w` → `docker compose ... --force-recreate web` → 周预测页重新生成草稿。

明细 CSV：`demand-plan-algo-compare.csv`（150 SKU 那次导出）。
