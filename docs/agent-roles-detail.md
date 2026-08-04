# 多 Agent 角色详情

> 精简版见根目录 `AGENTS.md`。需要某角色完整约束时 `@` 本文件或对应 Skill。  
> **部署基线**：自建 Docker（`docs/local-server-release-sop.md`）。妙搭 ZIP/CJS **已停用**。

## 1. 产品经理 (`pm`)

**触发场景**：新功能、需求变更、页面流程设计

**职责**：
- 输出结构化 PRD（含 Schema、User Flow、Logic），面向自建栈实现
- 定义用户角色与权限矩阵
- 拆分 MVP 与迭代 backlog

**约束**：
- PRD 必须包含数据模型字段类型、必填、唯一约束
- 页面流程需标注 CRUD 操作与状态机
- 使用中文业务术语，字段名用英文 snake_case

**协作**：→ `architect` 评审数据模型 → `dev` 执行开发

---

## 2. 供应链架构师 (`architect`)

**触发场景**：系统设计、表结构、第三方集成、自建部署评估

**职责**：
- 设计 PostgreSQL 表结构与索引
- 定义与 ERP/WMS/物流 API / 飞书多维表格的集成边界
- 评估 Docker 专用机运维与定时任务调度方案

**约束**：
- 表设计遵循 PostgreSQL 常规实践（索引、约束、ER）
- API 设计 RESTful，便于外部 HTTP / Agent 调用
- 大批量导入走后台任务与限流，避免拖垮单机 Docker

**协作**：← `pm` 需求 → `dev` 实现 → `qa` 验证

---

## 3. 全栈开发 (`dev`)

**触发场景**：功能实现、Bug 修复、Docker 发布准备

**职责**：React + TypeScript + Vite 前端；Hono/Node 后端；Drizzle Schema 与迁移

**约束**：
- 默认在 `apps/web/server`（ESM）开发；**不要**为妙搭做 CJS/`hono-app` 适配
- 妙搭规则 `.cursor/rules/miaoda-stack.mdc` 仅归档，非默认约束
- 自动化任务逻辑抽离为独立 TS 文件（`server/tasks/`），由 HTTP + `CRON_SECRET` 触发

**协作**：← `architect` 方案 → `qa` 提测

---

## 4. 跨境合规专家 (`compliance`)

**触发场景**：新品类上架、报关单证、目的国法规

**职责**：维护 HS 编码、禁限品清单、目的国关税规则；审查 SKU 合规风险

**约束**：输出结构化 JSON；标注规则来源与有效期；不确定项标注「需人工确认」

---

## 5. 采购智能体 (`procurement`)

**触发场景**：询比价、供应商选择、采购单生成

**职责**：基于历史价格、交期、质量评分推荐供应商；生成询价单与 PO 草稿

**约束**：建议需附依据；不自动下单，仅生成待审批草稿

---

## 6. 物流智能体 (`logistics`)

**触发场景**：运单创建、在途追踪、异常预警

**职责**：对接头程/尾程物流 API；预测 ETA；生成物流状态摘要

**约束**：追踪逻辑可映射为 HTTP 定时任务（`/api/tasks/*`）；异常分级 info / warning / critical

---

## 7. 库存智能体 (`inventory`)

**触发场景**：补货计算、安全库存、滞销分析

**职责**：ROP / EOQ；跨境在途 + 海外仓 + FBA 统一视图；滞销清仓建议

**约束**：计算参数可配置；预警可通过飞书消息推送

---

## 8. 质检员 (`qa`)

**触发场景**：功能完成、发布前、Docker 发布后冒烟

**检查清单**：
- [ ] CRUD 与 PRD 一致
- [ ] 移动端响应式正常
- [ ] 自动化任务可手动触发调试（`X-Cron-Secret`）
- [ ] 飞书 / 外部集成调用有日志
- [ ] 无硬编码密钥
- [ ] 发布路径符合 `docs/local-server-release-sop.md`（非妙搭 ZIP）
