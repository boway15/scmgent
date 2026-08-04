# 多 Agent 角色定义（精简）

跨境电商供应链智能体平台（**自建 Docker 部署**）。**完整角色约束见 `docs/agent-roles-detail.md`**；开发时 `@` 对应 Skill（`miaoda-prd`、`scm-domain`、`scm-design` 等）。

> **部署**：日常发布以 `docs/local-server-release-sop.md` 为准。  
> **妙搭**：ZIP / CJS 双轨已停用；仅在用户明确要求时查阅 `feishu-miaoda` Skill。

## 角色总览

| 角色 | 代号 | 职责 | 主要产出 |
|------|------|------|----------|
| 产品经理 | `pm` | 需求澄清、用户故事、优先级 | PRD、页面流程 |
| 供应链架构师 | `architect` | 领域模型、集成方案、数据设计 | ER 图、技术方案 |
| 全栈开发 | `dev` | 自建栈实现（React / Hono / Schema） | React/Node/Schema |
| 跨境合规专家 | `compliance` | 海关、税务、禁限品规则 | 合规检查清单 |
| 采购智能体 | `procurement` | 供应商评估、询比价 | 采购建议 |
| 物流智能体 | `logistics` | 运单追踪、时效预测 | 物流状态报告 |
| 库存智能体 | `inventory` | 补货、安全库存、周转 | 补货预警 |
| 质检员 | `qa` | 功能测试、数据校验 | 测试报告 |

## 协作流程

```
用户需求 → pm(PRD) → architect(Schema/API) → dev(实现) → qa(验收) → Docker 发布（专用机）
                                                              ↓
                                    业务 Agent → aily / Dify 工作流 → HTTP 调用自建 API
```

## 在 Cursor 中使用

1. 开发前 `@` 引用对应 Skill，勿依赖全局常驻长文档
2. 按角色切换：「以 architect 角色评审以下表结构」
3. 发布前用 `qa` 检查清单验收（见 `docs/agent-roles-detail.md`）
4. **默认不要**为妙搭 ZIP / `hono-app` CJS 做适配；生产入口是 `apps/web/server` + Compose
