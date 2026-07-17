# 大件备货申请 · 企业微信超时提醒

从飞书多维表格 **大件备货申请** 拉取数据，筛选后推送企业微信群机器人。

> 工作流结构对齐 `飞书新闻-企业微信分类推送.yml`：定时触发 → HTTP 取 Token → search 查表 → Code 筛选 → if-else → 生成消息 → 推送企微。

## 业务规则

| 项目 | 说明 |
|------|------|
| 数据源 | 飞书多维表格 `大件备货申请` |
| 服务端筛选 | 仅 `订单确认状态` = **待供应商确认**（`推送时间` 为文本列 fieldType=1，不支持 `isLess`） |
| 排序 | `推送时间` 升序，超期旧单优先进入第一页（≤500） |
| 本地筛选 | 日历超期：**不计今天**，超过 N 天（默认 2）。例：今天 `7/17` → 统计 `7/14` 及之前（`cutoff` = `7/15 00:00`，推送时间早于该时刻） |
| 推送格式 | 企业微信 **markdown**：加粗标题 + 引用元信息 + 供应商条数（**不展示 SKU**） |
| 字数限制 | 企业微信单条 **≤1300 汉字**，超出自动拆分 |
| 拆条标注 | 第 2 条起标题带 `(续2)`、`(续3)`…（对齐新闻简讯） |

### 消息示例

```markdown
**大件备货申请·待供应商确认超2天**
> 共 93 条 / 8 家供应商，生成时间：2026-07-17 09:00:00

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
      ├─ 是 → 按供应商生成推送内容 → 推送企业微信 → 推送完成
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
| `WECOM_HOOK_KEY` | ✓ | 企微 Webhook 的 `key=` 值 |
| `DAYS_THRESHOLD` | — | 默认 `2`（不计今天；今天 7/17 → 统计 7/14 及之前） |

> **注意**：Dify 环境变量与 scm-agent 后端 `.env` **相互独立**。仅在 scm-agent 配置了飞书凭证，但未在 Dify 工作流环境变量中填写，会出现 `code=10003 invalid param`。

3. 若 `FEISHU_APP_TOKEN` / `FEISHU_TABLE_ID` 与默认不同，还需修改 **查询飞书多维表格** 节点的 URL（HTTP 节点 URL 写死，环境变量仅作说明）
4. **保存并重新发布** 工作流（改环境变量后必须发布才生效）
5. 定时触发器默认工作日 **09:00**（Asia/Shanghai），可在画布调整

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
| `push_count` / `push_results` | 企微推送结果 |

**无待推送**：

| 变量 | 说明 |
|------|------|
| `matched_count` | 0 |
| `scanned_count` | 飞书返回行数 |
| `skipped_json` | 跳过原因统计 |

## 手动试运行

导入后可在 Dify 点击 **运行**（不依赖定时触发器）。调试时建议先把定时触发器边断开，或临时禁用发布计划。

## 与新闻推送工作流的差异

| 对比项 | 新闻推送 | 大件备货提醒 |
|--------|----------|--------------|
| 分组维度 | 新闻分类 | 供应商简称 |
| 消息类型 | markdown | markdown（含拆条 `(续N)`） |
| 字数限制 | 按 UTF-8 字节 | 按 **1300 汉字** |
| 查表条件 | 采集日期=当天 | 订单确认状态=待供应商确认 |
| 二次筛选 | 采集日期 | 推送日历超 N 天（不计今天） |

## 飞书前置条件

1. 应用开通 `bitable:app` 权限
2. 应用已加入目标多维表格协作者
3. 详见 [feishu-bitable-sync.md](../../feishu-bitable-sync.md)
