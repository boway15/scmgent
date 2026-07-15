# 多 Agent 角色定义（精简）

跨境电商供应链智能体平台，对齐飞书妙搭「AI 产研团队」。**完整角色约束见 `docs/agent-roles-detail.md`**；开发时 `@` 对应 Skill（`miaoda-prd`、`scm-domain`、`feishu-miaoda` 等）。

## 角色总览

| 角色 | 代号 | 职责 | 主要产出 |
|------|------|------|----------|
| 产品经理 | `pm` | 需求澄清、用户故事、优先级 | PRD、页面流程 |
| 供应链架构师 | `architect` | 领域模型、集成方案、数据设计 | ER 图、技术方案 |
| 全栈开发 | `dev` | 妙搭兼容代码实现 | React/Node/Schema |
| 跨境合规专家 | `compliance` | 海关、税务、禁限品规则 | 合规检查清单 |
| 采购智能体 | `procurement` | 供应商评估、询比价 | 采购建议 |
| 物流智能体 | `logistics` | 运单追踪、时效预测 | 物流状态报告 |
| 库存智能体 | `inventory` | 补货、安全库存、周转 | 补货预警 |
| 质检员 | `qa` | 功能测试、数据校验 | 测试报告 |

## 协作流程

```
用户需求 → pm(PRD) → architect(Schema/API) → dev(实现) → qa(验收) → 导入妙搭/ZIP
                                                              ↓
                                    业务 Agent → aily 工作流 → HTTP 调用妙搭 API
```

## 在 Cursor 中使用

1. 开发前 `@` 引用对应 Skill，勿依赖全局常驻长文档
2. 按角色切换：「以 architect 角色评审以下表结构」
3. 发布前用 `qa` 检查清单验收（见 `docs/agent-roles-detail.md`）
