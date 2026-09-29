# FOB 货代按起运港分摊规则 · 设计说明

**日期**：2026-09-29  
**状态**：已实现  
**关联**：`.cursor/rules/fob-settlement-dev.mdc`、`docs/prd/mvp-fob-fee-allocation-rules.md`

---

## 1. 背景

货代账单在不同起运港的分摊口径不一致。现有 `fob_fee_allocation_rules` 为全局规则，无法按港口区分。需：

1. 按港口维护完整货代规则集  
2. 体积导入带起运港，核算取对应港口规则  
3. 导出文件名加入批次名称  
4. 导出 Sheet2 说明分摊口径与本批规则

---

## 2. 决策摘要

| 项 | 决策 |
|----|------|
| 规则模型 | 每个起运港一套完整货代规则 |
| 适用范围 | 仅货代；拖车仍用全局规则（`port_id` 为空） |
| 港口匹配 | `fob_ports.name` 与体积「起运港」精确匹配（暂无别名） |
| 体积列 | 截单清单「工厂类型」后增加「起运港」 |
| 导出名 | `{批次号}_{批次名称}_分摊总账.xlsx` / `{批次号}_{批次名称}_按工厂主体导出.zip` |
| ZIP 内单厂 | 文件名不变 |
| Sheet2 | 固定口径说明 + 本批次规则明细；总账与 ZIP 内 xlsx 均带 |

---

## 3. 数据模型

### 3.1 `fob_ports`

| 字段 | 说明 |
|------|------|
| id | UUID |
| name | 唯一；与体积起运港精确匹配 |
| code | 可选唯一短码；模板港 code=`__TEMPLATE__` |
| is_active | 停用后不可新匹配 |
| remark / 时间戳 | 常规 |

### 3.2 `fob_fee_allocation_rules.port_id`

- 可空 FK → `fob_ports`
- trucking：必须 `NULL`
- freight：必须非空（挂在港口上）
- 迁移：既有 freight 全局规则挂到种子「模板港口」

### 3.3 `fob_merchant_shipments.origin_port`

- 可空 varchar，存导入原文
- 货代批次参与分账行必填且须匹配启用港口
- 同柜起运港必须唯一

---

## 4. 匹配链路（货代）

```
货代账单行(柜号)
  → 柜体积 origin_port
  → fob_ports.name
  → 该港 freight 规则集
  → findMatchingFeeRule / matchAllocationRule
找不到港或费用未命中 → unconfigured
```

拖车：仅匹配 `port_id IS NULL` 的 trucking 规则。

---

## 5. 导入与 UI

- 解析列「起运港」；模板 headers 追加
- 货代：缺港 / 未登记 / 同柜多港 → 行级 errors
- 分摊基数表展示起运港
- 规则页：港口 CRUD；货代先选港再维护；「复制规则集到目标港」

---

## 6. 导出 Sheet2

1. 固定说明：按体积 / 按票 / 需确认  
2. 明细表：起运港（货代）| 费用类型 | 匹配方式 | 分摊方式 | 费用阶段  

---

## 7. 非目标

- 港口别名映射  
- 批次级规则快照表  
- 拖车按港口规则  
