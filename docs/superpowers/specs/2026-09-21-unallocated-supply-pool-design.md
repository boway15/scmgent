# 未定仓供应池

**版本**：v1.0（2026-09-21）  
**定位**：把 `warehouse=OVERSEAS` 的开放批次做成可确认落仓的供应池；确认结果写入独立表，三池同步后仍尊重。  
**本期不做**：网络优化求解器、停止有占比时的自动拆仓、改时间轴公式。

**关联**：S&OP Demo「未分配供应池」；09-18 分仓投影；数据问题队列（未分仓工单）。

---

## 1. 目标

工厂货 / 无占比海外合计停在 OVERSEAS，不能当某仓确定供给。业务确认目的仓后才落仓。

成功标准：

- 待分配页列出开放的 OVERSEAS 批次，可按占比给草案，确认后拆到目的仓。
- 确认写入 `inventory_dest_allocations`；下次 `syncInventorySupplyLots` 不会把已确认件数打回 OVERSEAS。
- SKU 规划页展示「网络未定仓」件数，并链到待分配。
- 分配件数之和必须等于批次数量；禁止落到 OVERSEAS / IN-PRODUCTION。

---

## 2. 决策

| 项 | 选择 |
|----|------|
| 未定仓判定 | `status=open` 且 `warehouseCode=OVERSEAS` |
| 建议去向 | 有销售占比则 `allocateByShare` 草案；无占比则手选仓 |
| 持久化 | 新表确认行，不把 snapshot 批次改成 manual |
| 同步 | `buildLotsFromInputs` 之后、`persistBuiltLots` 之前套用确认 |
| 优先级 | 已确认落仓 > 仍停在 OVERSEAS 的残差 |

---

## 3. 非范围

- 不自动把有占比的 `avail-share` 批次改回未确认。
- 不改 7/15/30 公式；落仓后自然进入该仓确定线。
