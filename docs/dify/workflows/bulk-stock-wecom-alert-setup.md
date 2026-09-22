# [家具/创新]_大件备货·待供应商确认超2天

从飞书多维表格 **大件备货申请** 拉取「待供应商确认」且**超 2 天（大前天及之前）**的记录，由**采购跟进**催办，推送飞书群机器人。

> 前天当天由超 1 天提醒覆盖，两条按日期互斥。

## 业务规则

| 项目 | 说明 |
|------|------|
| 数据源 | 飞书多维表格 `大件备货申请` |
| 服务端筛选 | 仅 `订单确认状态` = **待供应商确认**（`推送时间` 为文本列 fieldType=1，不支持 `isLess`） |
| 跟进人 | 采购 |
| 排序 | `推送时间` 升序，超期旧单优先进入第一页（≤500） |
| 本地筛选 | 日历超期：**不计今天**，超过 **2** 天。例：今天 `7/17` → 统计 `7/14` 及之前 |
| 推送格式 | 红色卡片 **待供应商确认 · 超2天**；正文含「采购跟进」 |
| 字数限制 | 单条 **≤4000 字**，超出自动拆分 |
| 拆条标注 | 第 2 条起标题带 `(续2)`、`(续3)`… |
| 查看明细 | [超2日视图](https://chinabestwo.feishu.cn/base/HPJzbHdPea7elSs92T8c31BTnxe?table=tbl7H8F6rc2xeFGf&view=vewLM617rt) |

### 消息示例

```markdown
**大件备货申请·待供应商确认超2天**
采购跟进 · 共 93 条 / 8 家供应商，生成时间：2026-07-17 09:00:00

**BDJJ** 3条

**CZHD** 68条

[查看明细](https://chinabestwo.feishu.cn/base/HPJzbHdPea7elSs92T8c31BTnxe?table=tbl7H8F6rc2xeFGf&view=vewLM617rt)
```

拆条后续篇标题示例：`**大件备货申请·待供应商确认超2天 (续2)**`；元信息（总条数/供应商数）与明细链接每条重复。

格式要点：只展示供应商简称与条数，**不展示 SKU**；标题区与供应商块之间空一行；末尾为 Markdown 链接。

## 节点链路

```
定时触发器
  → 解析超时阈值
  → 获取飞书 Token (Code，从环境变量读凭证)
  → 构建查表条件（待供应商确认 + 推送时间升序）
  → 查询飞书多维表格 (HTTP search，超时 60s)
  → 筛选超时待确认
  → 是否有待推送 (if-else)
      ├─ 是 → 按供应商生成推送内容 → 推送飞书 → 推送完成
      └─ 否 → 无待推送
```

## 导入步骤

1. Dify 控制台 → **工作室** → **导入 DSL** → 选择 `bulk-stock-wecom-alert.yml`
2. 打开工作流 → **环境变量**，**必填**填写飞书凭证（与 scm-agent `.env` 中 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 相同）：

| 变量 | 必填 | 说明 |
|------|:----:|------|
| `FEISHU_APP_ID` | ✓ | 飞书 App ID（`cli_` 开头） |
| `FEISHU_APP_SECRET` | ✓ | 飞书 App Secret |
| `FEISHU_APP_TOKEN` | ✓ | 默认 `HPJzbHdPea7elSs92T8c31BTnxe` |
| `FEISHU_TABLE_ID` | ✓ | 默认 `tbl7H8F6rc2xeFGf` |
| `FEISHU_BOT_WEBHOOK_URL` | ✓ | 飞书自定义机器人 Webhook 完整 URL |
| `DAYS_THRESHOLD` | — | 默认 `2`（不计今天；今天 7/17 → 统计 7/14 及之前） |

> **注意**：Dify 环境变量与 scm-agent 后端 `.env` **相互独立**。仅在 scm-agent 配置了飞书凭证，但未在 Dify 工作流环境变量中填写，会出现 `code=10003 invalid param`。

3. 若是**覆盖导入已有应用**：删除旧的 `WECOM_HOOK_KEY`，确认 `FEISHU_BOT_WEBHOOK_URL` 为完整 webhook 地址
4. 若 `FEISHU_APP_TOKEN` / `FEISHU_TABLE_ID` 与默认不同，还需修改 **查询飞书多维表格** 节点的 URL（HTTP 节点 URL 写死，环境变量仅作说明）
5. **保存并重新发布** 工作流（改环境变量后必须发布才生效）
6. 定时触发器默认工作日 **09:00**（Asia/Shanghai），可在画布调整

> **限制说明**：Dify Code 沙箱约 **15 秒**超时，查表走 HTTP 节点（60s）。`推送时间` 为文本列，飞书无法服务端按日期比较，只能本地按日历超期筛选。按推送时间升序后，超期约 100～300 条应落在第一页 500 内。
>
> 长期建议：把飞书「推送时间」改为**日期**列，即可用服务端 `isLess` 精确过滤。

## 常见错误

| 报错 | 原因 | 处理 |
|------|------|------|
| `code=10003 invalid param` | `FEISHU_APP_ID` / `FEISHU_APP_SECRET` 未填或 HTTP 未注入 | 在 Dify 工作流环境变量填写凭证并**重新发布**；v2 已改为 Code 节点取 Token |
| `code=10014 app secret invalid` | App Secret 错误或已重置 | 飞书开放平台重新复制 Secret |
| `FEISHU_APP_ID 未配置或为空` | 环境变量为空 | 同上，填写后发布 |
| `matched_count=0` 且 `skipped_json.time_too_recent` 很高 | 第一页多为近 N 天内推送 | 已按推送时间**升序**，超期旧单优先；看 `debug_sample` / `cutoff_date_text` |
| `skipped_json.time_parse_fail` 很高 | `推送时间` 字段格式无法解析 | 查看 `debug_sample`；确认列名与格式 |
| 飞书 `1254018 InvalidFilter` / fieldType 1 not support isLess | `推送时间` 是文本列 | 已去掉服务端 `isLess`，改本地比较 |

### skipped_json 字段说明

| 键 | 含义 |
|----|------|
| `status` | 订单确认状态不是「待供应商确认」 |
| `time_parse_fail` | 推送时间为空或格式无法解析 |
| `time_too_recent` | 推送日历日未达超期（默认：今天与近 2 天内） |
| `sku` | SKU 为空 |

> scm-agent 同步到飞书的列均为**文本类型**，推送时间不能在飞书 search 里做日期比较，必须在「筛选超时待确认」节点本地解析。

## 飞书字段

与 `apps/web/server/lib/procurement-bitable-list.ts` 对齐：

- `订单确认状态`
- `推送时间`
- `供应商简称`
- `SKU`
- `需求单号`（辅助，不写入推送正文）

## 输出变量

**推送完成**（有数据时）：

| 变量 | 说明 |
|------|------|
| `matched_count` | 命中行数 |
| `supplier_count` | 供应商数 |
| `message_count` | 拆分后消息条数 |
| `push_meta` | 各供应商条数 JSON |
| `push_count` / `push_results` | 飞书推送结果（含 `sent` 与 `skipped_duplicate`） |

**无待推送**：

| 变量 | 说明 |
|------|------|
| `matched_count` | 0 |
| `scanned_count` | 飞书返回行数 |
| `skipped_json` | 跳过原因统计 |

## 手动试运行

导入后可在 Dify 点击 **运行**（不依赖定时触发器）。**只点一次**；发布不会自动再推，但「运行」会真实发到飞书群。调试时建议先把定时触发器边断开，或临时禁用发布计划。

## 为何可能连推两条

| 原因 | 如何辨认 | 处理 |
|------|----------|------|
| 配置验证请求 + 工作流运行 | 其中一条正文含「配置校验 / 校验供应商」 | 属一次性验证，忽略即可 |
| 同一应用点了两次「运行」 | 两条业务正文完全相同 | 只运行一次 |
| 超长拆条 | 第二条标题带 `(续2)` | 正常，不是重复 |
| Code 节点超时重跑 | 两条完全相同且 Dify 日志有超时/重试 | 已将 webhook 超时改为 8s，并在同一次运行内对相同正文去重 |

## 与新闻推送工作流的差异

| 对比项 | 新闻推送 | 大件备货提醒 |
|--------|----------|--------------|
| 分组维度 | 新闻分类 | 供应商简称 |
| 消息类型 | markdown | 飞书消息卡片（含拆条 `(续N)`） |
| 字数限制 | 按 UTF-8 字节 | 按 **4000 字** |
| 查表条件 | 采集日期=当天 | 订单确认状态=待供应商确认 |
| 二次筛选 | 采集日期 | 推送日历超 N 天（不计今天） |

## 飞书前置条件

1. 应用开通 `bitable:app` 权限
2. 应用已加入目标多维表格协作者
3. 详见 [feishu-bitable-sync.md](../../feishu-bitable-sync.md)
