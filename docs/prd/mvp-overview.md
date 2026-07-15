# MVP 总体规划

**版本**：v1.2（2026-06-25 修订）  
**目标**：预测驱动的补货履约闭环，运行于飞书妙搭

## 模块清单

| # | 模块 | 文档 | MVP 平台 | 优先级 |
|---|------|------|----------|--------|
| 1 | 角色权限 + 自定义菜单 | [mvp-roles.md](mvp-roles.md) | 妙搭本地 | P0 |
| 2 | 商品主数据（SPU/SKU/商家） | [mvp-product-master-data.md](mvp-product-master-data.md) | 妙搭本地 | P0 |
| 3 | 库存录入 + 表格导入 | [mvp-inventory-replenishment.md](mvp-inventory-replenishment.md) | 妙搭本地 | P0 |
| 4 | 安全库存 + 补货预测 + 缺货预警 | 同上 | 妙搭本地算法 | P0 |
| 5 | PMC 需求计划 + 采购跟单履约闭环 | [mvp-pmc.md](mvp-pmc.md) / [mvp-business-loop.md](mvp-business-loop.md) | 妙搭本地 | P0 |
| 6 | 跨境合规主数据 | [mvp-compliance.md](mvp-compliance.md) | 妙搭本地 | P1 |
| 7 | AI 助手（本地 FAQ + 业务嵌入） | [mvp-ai-knowledge.md](mvp-ai-knowledge.md) | 本地（Dify 预留） | P1 |
| 8 | FOB 分账 | — | 妙搭本地 | P1 |
| 9 | 经营看板 + 销量历史 | — | 妙搭本地 | P1 |

## 明确不做（本期）

- 正式采购单 / PO 审批
- BOM / 物料需求拆解
- Dify 对接（代码预留，下期启用）
- 合规规则库 / 合规 Agent
- ERP/WMS API

## 数据录入方式

- **手工录入**：SKU、库存、销量、合规属性
- **CSV 导入**：销量、库存、计划、合规等
- **PMC 下发**：导出 CSV → 人工发送商家

## 妙搭自动化任务

| 任务名 | Cron | 逻辑 |
|--------|------|------|
| `stockAlert` | 每日 07:00 | 本地规则检测 → 写预警 → 飞书推送（可选） |
| `replenishmentForecast` | 每周一 06:00 | 本地 EOQ/ROP → 写补货建议 |

## 开发顺序

```
已完成 / 进行中
  1. 脚手架 + DB + 角色菜单
  2. 库存 + 补货 + 预警
  3. PMC 计划 + 采购跟单 + 计划导出
  4. 商品主数据 + FOB 分账

已完成迭代
  5. 合规独立菜单（阶段 A）
  6. AI 本地助手（阶段 A+B，不启 Dify）
  7. 经营看板 + 销量历史查询
  8. 安全加固（菜单级 RBAC、上传限制、CRON_SECRET）
  9. 多仓一致性（安全库存/预警 warehouse_code）
  10. PRD 小补齐（库存/销量导出、PMC XLSX、跟单跳转、qty_reserved）
  11. 体验增强（看板趋势、预警问 AI、导入预览、角色 CRUD、AI 限流）

后续 Phase
  12. 启用 Dify RAG + Workflow
  13. 合规规则库 + Agent
  14. 物流在途追踪
```
