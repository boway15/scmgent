# FOB 导出宽表：费用项「总 / 承担」双列

**日期**：2026-11-10  
**模块**：FOB 分账（仅导出）  
**方案**：A — 在现有 `buildMerchantBillWideExportAoa` 内改费用区列结构  

## 背景

按工厂/主体导出与分摊总账共用账单宽表。费用区目前每个费用项一列，值为该柜账单**总金额**；工厂分摊金额仅出现在行尾「承担金额」汇总列。业务需要在每个费用项上同时看到总金额与该工厂承担金额（例：`ORC-总`、`ORC-承担`）。

## 范围

| 包含 | 不包含 |
|------|--------|
| `buildMerchantBillWideExportAoa` 费用区双列 | 导入模板、账单解析 |
| `buildTotalBillWideExportAoa`（复用上述函数，自动一致） | 平账矩阵 UI、调账 API |
| `fob-reconcile-export.test.ts` 断言更新 | 阶梯表 / 其它非宽表导出 |
| `.cursor/rules/fob-settlement-dev.mdc` 导出说明同步 | DB / Schema 变更 |

导出入口不变：`export/reconcile-total`、`export/reconcile-by-merchant`。

## 列结构

```
[账单 meta…] + 对每个费用项: {费用名}-总, {费用名}-承担 + [行尾追加列…]
```

- 费用清单：仍为 `TRUCKING_FEE_HEADERS` / `FREIGHT_FEE_HEADERS` 全量固定顺序（含金额为 0 的项）。
- 表头命名：`{feeType}-总`、`{feeType}-承担`（例：`ORC-总`、`ORC-承担`、`拖车费-总`、`拖车费-承担`）。
- 行尾追加列不变：`合计金额 | 承担金额 | 总体积 | 承担体积 | 体积占比 | 承担工厂/主体 | 收款公司名称`。

## 取值规则

| 列 | 含义 | 数据来源 |
|----|------|----------|
| `{fee}-总` | 该柜该费用账单总额 | 账单 pivot（与现状单列费用值相同） |
| `{fee}-承担` | 该行工厂在该柜该费用的分摊金额 | `allocations` 中匹配 `containerNo + merchantCode + feeType` 的 `allocatedAmountCny` 求和；无记录为 `0` |
| `合计金额` | 本柜账单费用合计 | 现有 `containerBillTotals` |
| `承担金额` | 本行工厂本柜分摊合计 | 现有 `sumAllocatedByContainer` |

金额均 `round2`。同一柜同一费用若有多条 allocation，承担列累加。

## 实现要点

- 改动集中在 `apps/web/server/lib/fob-reconcile-export.ts` 的 `buildMerchantBillWideExportAoa`。
- 抽取小函数生成费用双列表头，以及按柜+工厂汇总各费用承担金额（避免在行循环内全表扫描过重；可对当前 `merchantCode` 预聚合 `Map<containerNo, Map<feeType, number>>`）。
- 分摊总账无需单独分支：继续调用 `buildMerchantBillWideExportAoa`。
- 同步更新 `fob-settlement-dev.mdc`「导出」一节中费用列描述。

## 测试

在 `fob-reconcile-export.test.ts` 的宽表用例中：

1. 表头含 `拖车费-总`、`拖车费-承担`，且不再含孤立的 `拖车费`（费用区）。
2. 工厂 A 行：`拖车费-总 === 1000`，`拖车费-承担 === 600`。
3. 工厂 B 行：`拖车费-总 === 1000`，`拖车费-承担 === 400`。
4. 总账与各主体行仍表头一致、行数据拼接关系不变。
5. 行尾 `合计金额` / `承担金额` 既有断言保持。

## 验收

- 下载「分摊总账」与「按工厂/主体导出」ZIP 内 xlsx，费用区均为「-总 / -承担」成对列。
- 同一柜多工厂时，各行 `-总` 相同，`-承担` 为该工厂分摊值，行尾汇总与分项承担之和一致（在现有分摊数据正确的前提下）。
