---
name: miaoda-prd
description: >-
  生成结构化 PRD（数据模型、页面流程、业务逻辑），面向自建 Docker 栈实现。
  Use when writing requirements, PRD, user stories, or data schema for scm-agent
  (React/Hono/Postgres). Not for 飞书妙搭 ZIP import.
---

# SCM PRD 编写规范

> Skill 目录名保留 `miaoda-prd` 以兼容既有 `@` 引用；**产出面向自建栈**（`apps/web` + Docker），不是妙搭导入模板。

PRD 结构化程度决定实现质量。描述越准确，代码与验收越稳。

## PRD 必备部分

1. **需求分析** — 用户角色、痛点、目标
2. **数据模型（Schema）** — 表、字段、关系、约束
3. **页面流程（User Flow）** — 页面清单、跳转、操作
4. **关键业务逻辑（Logic）** — 状态机、计算规则、集成点

## 输出模板

```markdown
# [功能名称] PRD

## 1. 需求分析

### 背景
[一句话业务背景]

### 用户角色
| 角色 | 权限 | 典型操作 |
|------|------|----------|
| 采购员 | 读写采购单 | 创建 PO、审批 |

### 用户故事
- 作为 [角色]，我希望 [操作]，以便 [价值]

## 2. 数据模型

### 表：suppliers（供应商）
| 字段 | 类型 | 必填 | 唯一 | 说明 |
|------|------|------|------|------|
| id | uuid | ✅ | ✅ | 主键 |
| name | varchar(200) | ✅ | | 供应商名称 |
| country | varchar(2) | ✅ | | ISO 国家码 |
| status | enum | ✅ | | active/inactive |
| created_at | timestamptz | ✅ | | 创建时间 |

### 关系
- suppliers 1:N purchase_orders

### 索引
- suppliers(country, status)

## 3. 页面流程

### 页面清单
| 页面 | 路由 | 功能 |
|------|------|------|
| 供应商列表 | /suppliers | 列表、搜索、新建 |
| 供应商详情 | /suppliers/:id | 查看、编辑 |

### 流程
[列表] → 点击新建 → [表单] → 保存 → 返回列表

## 4. 业务逻辑

### 状态机：purchase_orders.status
draft → pending_approval → approved → shipped → completed
                              ↓
                          cancelled

### 规则
- 金额 > 10万 需总监审批
- 每日 08:00 同步物流状态（HTTP 定时任务 `/api/tasks/*`）

## 5. 集成
- 飞书：审批结果推送群消息 / 多维表格同步
- 外部：物流 API GET /tracking/{no}
- 部署：自建 Docker（见 docs/local-server-release-sop.md）
```

## 字段命名约定

- 表名、字段名：`snake_case` 英文
- 枚举值：`snake_case` 小写
- 主键统一 `id`（uuid）
- 时间戳：`created_at`、`updated_at`

## 质量检查

- [ ] 每张表有主键和 created_at
- [ ] 外键关系明确
- [ ] 每个页面标注 CRUD 操作
- [ ] 状态流转完整且无孤立状态
- [ ] 自动化任务写明触发方式（HTTP + Cron 建议时刻）与执行逻辑
- [ ] 不默认要求「导入妙搭 / ZIP」
