# Task 1 Report: 边界文档核对（无代码行为变更）

**Status:** DONE  
**Branch:** `feat/inventory-planning-boundary-p0`  
**Commit:** `fd9a829` — `docs: lock inventory planning / PMC boundary for P0`

---

## 1. 任务目标

核对 `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` 的 §1.2、§14、§16.1 与 plan Global Constraints 一致；可选在 `docs/prd/mvp-overview.md`「后续 Phase」增加一行引用。无运行时代码变更。

---

## 2. 核对清单（Global Constraints ↔ 设计文档）

| Global Constraint | 设计文档位置 | 结果 |
|-------------------|-------------|------|
| 双引擎职责边界（库存规划 vs 供应商 PMC） | §1.2 引擎定义 + 职责表 | ✅ 一致 |
| 默认去重模式 `drafts_fill_gap` | §4.2 首版默认说明；§16.1 锁定 | ✅ 一致 |
| 物理仓不重复摊 SKU 级 IN-PRODUCTION | §16.1 + §16 风险表 | ✅ 一致 |
| `exception` → `confirmedOpen` + `atRisk` | §4.2 状态映射；§16.1 | ✅ 一致 |
| 跟单仓归属规则 | §16.1 | ✅ 一致 |
| `eta_available` 为主字段 | §8.2、§16.1 | ✅ 一致 |
| P0 不做：lead_time_profiles / shipments / SKU 规划页 | §13 分期 P1/P2；§16.1 SKU 规划页 P1；§16.2 非目标 | ✅ 一致 |
| P0 不做：断货修正、Z 值、驾驶舱、SAP、正式 PO、BOM、FOB 改动 | §14 非范围；§16.2 | ✅ 一致 |
| 扩展现表，禁止平行主路径 | §1.3 原则 | ✅ 一致 |

**结论：** 设计文档已完整覆盖 Global Constraints，§16.1 无需补写或修改。

---

## 3. 变更摘要

| 文件 | 操作 |
|------|------|
| `docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md` | 新增入库（内容已满足边界，无正文修改） |
| `docs/prd/mvp-overview.md` | 在「后续 Phase」追加第 15 项引用 spec |

**未修改：**「明确不做（本期）」列表（按要求保持不变）。

追加内容：

```markdown
15. 库存规划与 PMC 演进（见 docs/superpowers/specs/2026-07-29-inventory-planning-pmc-evolution-design.md）
```

---

## 4. Self-review

### §1.2 双引擎

- 库存规划引擎：需求预测 + 库存位置 + 提前期 + 安全库存/覆盖天数 + 补货建议
- 供应商 PMC 引擎：采购计划 + 交期承诺 + 状态跟单 + 发运里程碑 + 到货回写
- 职责表明确划分「负责 / 不负责」，与 plan 描述无冲突

### §14 非范围

与 P0 Global Constraints 及 `mvp-overview`「明确不做」无矛盾（正式 PO、BOM、SAP、船司 API 等均列明不做）。

### §16.1 / §16.2 P0 锁定

- 默认 `drafts_fill_gap` 已在 §16.1 首行锁定
- SKU 规划页、lead_time 运输方式维均标注 **P1**
- §16.2 显式列出 P0 不包含项，与 plan Task 8 验收「未做 P1+ 范围」对齐

### 潜在关注点（非阻塞）

- §4.2 仍描述三种可配置去重模式；§16.1 已锁定 P0 默认值为 `drafts_fill_gap`，语义清晰，不构成矛盾
- `mvp-overview` 仍标注「运行于飞书妙搭」为历史语境；本次任务未要求更新平台描述

---

## 5. 测试

N/A — 纯文档任务，无代码或运行时验证。

---

## 6. 交付物

- Git commit: `fd9a829`
- 本报告: `.superpowers/sdd/task-1-report.md`

---

## 7. Review fix（Important findings）

**触发：** Code review 指出 §4.2 `exception` 行与 §16.1 / Global Constraints 不一致（仍写「默认计入原桶」）。

**变更：**

| 位置 | 修改 |
|------|------|
| §4.2 `exception` 行 | 开放量计入 `confirmedOpen`，数量口径 `qty - receivedQty`，`sources` 打标 `atRisk: true`（移除「原桶」表述） |
| §4.2 去重规则第 2 点 | 补充「P0 锁定 `drafts_fill_gap`」 |

**未改：**「明确不做（本期）」及其他无关文档。

**确认：** §4.2 与 §16.1 / Global Constraints 现已一致。

**Commit message:** `docs: align exception bucket mapping with P0 lock`
