# 大件备货申请 · 待采购确认超时提醒

从飞书多维表格 **大件备货申请** 拉取数据，筛选「待采购确认」且推送日历超期后，推送企业微信群机器人。

> 结构对齐 `bulk-stock-wecom-alert.yml`（待供应商确认超 2 天版）；本工作流状态与天数不同。

## 业务规则

| 项目 | 说明 |
|------|------|
| 数据源 | 飞书多维表格 `大件备货申请` |
| 服务端筛选 | 仅 `订单确认状态` = **待采购确认** |
| 排序 | `推送时间` 升序，超期旧单优先进入第一页（≤500） |
| 本地筛选 | 日历超期：**不计今天**，超过 **1** 天。例：今天 `7/17` → 统计 **`7/15` 及之前**（前天及之前；`cutoff` = `7/16 00:00`） |
| 推送格式 | 企业微信 **markdown**：加粗标题 + 引用元信息 + 供应商条数（**不展示 SKU**） |
| 字数限制 | 单条 ≤1300 汉字，超出自动拆分并标注 `(续N)` |

### 与「待供应商确认」工作流对比

| 对比项 | 待供应商确认（`bulk-stock-wecom-alert.yml`） | 本工作流 |
|--------|---------------------------------------------|---------|
| 订单确认状态 | 待供应商确认 | **待采购确认** |
| 默认超期 | 超 2 天（不计今天）→ 大前天及之前 | **超 1 天（不计今天）→ 前天及之前** |
| 标题 | `…待供应商确认超2天` | `…待采购确认超1天` |

### 消息示例

```markdown
**大件备货申请·待采购确认超1天**
> 共 42 条 / 5 家供应商，生成时间：2026-07-17 09:00:00

**BDJJ** 3条

**CZHD** 12条

[查看明细](https://chinabestwo.feishu.cn/base/HPJzbHdPea7elSs92T8c31BTnxe?table=tbl7H8F6rc2xeFGf&view=vewLM617rt)
```

## 节点链路

```
定时触发器
  → 解析超时阈值（DAYS_THRESHOLD，默认 1）
  → 获取飞书 Token
  → 构建查表条件（待采购确认 + 推送时间升序）
  → 查询飞书多维表格 (HTTP search)
  → 筛选超时待确认
  → 是否有待推送
      ├─ 是 → 按供应商生成推送内容 → 推送企业微信 → 推送完成
      └─ 否 → 无待推送
```

## 导入步骤

1. Dify 控制台 → **工作室** → **导入 DSL** → 选择 `bulk-stock-procurement-pending-wecom-alert.yml`
2. 配置环境变量：

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `FEISHU_APP_ID` | ✓ | 飞书 App ID |
| `FEISHU_APP_SECRET` | ✓ | 飞书 App Secret |
| `FEISHU_APP_TOKEN` | ✓ | 默认 `HPJzbHdPea7elSs92T8c31BTnxe` |
| `FEISHU_TABLE_ID` | ✓ | 默认 `tbl7H8F6rc2xeFGf` |
| `WECOM_HOOK_KEY` | ✓ | 企微 Webhook `key=` |
| `DAYS_THRESHOLD` | — | 默认 `1`（今天 7/17 → 统计 7/15 及之前） |

3. **保存并重新发布**
4. 定时默认工作日 09:00（Asia/Shanghai）；可与「待供应商确认」工作流错开时段，避免同群连发

> 可与待供应商确认提醒使用**同一**飞书表与企微机器人，也可单独配置 `WECOM_HOOK_KEY` 推到不同群。

## skipped_json

| 键 | 含义 |
|----|------|
| `status` | 不是「待采购确认」 |
| `time_parse_fail` | 推送时间无法解析 |
| `time_too_recent` | 未达超期（默认：今天与昨天） |
| `sku` | SKU 为空 |

## 输出变量

与 `bulk-stock-wecom-alert-setup.md` 相同：`matched_count`、`supplier_count`、`message_count`、`push_meta`、`push_count` / `push_results`。
