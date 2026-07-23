# 跨境资讯 Dify 增强工作流契约

用于 `DIFY_API_KEY_NEWS_INTEL`。若未配置，中文信源走本地规则摘要；**英文一级官方内容仍可原文入表**（`原文标题` / 主键用英文，`中文标题` 留空），翻译可由飞书多维表格 AI 字段补全。

## 输入

| 字段 | 说明 |
|------|------|
| `title` | 原文标题 |
| `body_text` | 正文截断（≤3000） |
| `source_name` | 信源名称 |
| `language` | `zh` / `en` |
| `source_tier` | `tier_1` / `tier_2` / `tier_3` |
| `is_official` | `true` / `false` |

## 输出（JSON，可放在 `result` 字符串或顶层）

| 字段 | 必填 | 说明 |
|------|:----:|------|
| `summary` | ✅ | 简体中文事实摘要 |
| `title_zh` | 英文时必填 | 简体中文标题 |
| `topic_category` | — | 九类主题之一 |
| `departments` | — | 部门数组 |
| `tags` | — | 字符串数组 |
| `relevance_score` | — | 0–100 |
| `priority` | — | `high` / `medium` / `low` |
| `key_points` | — | 要点数组 |

九类主题：`产品开发与家具趋势`、`PMC与供应链`、`采购与供应商`、`物流海关与关税`、`平台运营`、`营销推广`、`视觉设计`、`AI前沿`、`法规与外部环境`。
