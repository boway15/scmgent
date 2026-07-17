# Dify Workflow DSL

## 大件备货申请 · 企业微信超时提醒

| 文件 | 说明 |
|------|------|
| `bulk-stock-wecom-alert.yml` | 待供应商确认 · 日历超 2 天（不计今天）→ 企微 Markdown |
| `bulk-stock-wecom-alert-setup.md` | 上项环境变量与节点说明 |
| `bulk-stock-procurement-pending-wecom-alert.yml` | 待采购确认 · 日历超 1 天（不计今天，前天及之前）→ 企微 Markdown |
| `bulk-stock-procurement-pending-wecom-alert-setup.md` | 上项环境变量与节点说明 |

结构对齐 `飞书新闻-企业微信分类推送.yml`：HTTP 取 Token → search 查表 → Code 筛选 → if-else → 分组生成 → 推送企微。

### 导入步骤

1. Dify 控制台 → **工作室** → **导入 DSL** → 选择对应 `.yml`
2. 配置环境变量：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_APP_TOKEN`、`FEISHU_TABLE_ID`、`WECOM_HOOK_KEY`、`DAYS_THRESHOLD`
3. 发布；默认定时工作日 09:00 自动执行

---

## 客服回复质量评估

| 文件 | 说明 |
|------|------|
| `cs-reply-quality.yml` | 评估客服英文邮件回复质量（总分 + 四维度 + 评语） |
| `cs-reply-quality-setup.md` | 导入步骤、API Key、试运行与对接约定 |

样例数据：`docs/samples/cs/tengfei近3个月买家消息.xlsx`

### 导入步骤

1. Dify 控制台 → **工作室** → **导入 DSL** → 选择 `cs-reply-quality.yml`
2. LLM 节点若报红，改为你实例已安装的模型
3. **发布** 应用 → 复制 API Key → `.env` 配置 `DIFY_API_KEY_CS_REPLY_QUALITY`
4. 详细说明见 [cs-reply-quality-setup.md](./cs-reply-quality-setup.md)

### 输入 / 输出摘要

| 输入 | 说明 |
|------|------|
| `buyer_message` | 买家消息（必填） |
| `agent_reply` | 客服回复（必填） |
| `message_type` | `售前` / `售后` |
| `order_no` / `agent_name` / `buyer_email` | 可选上下文 |
| `pass_threshold` | 及格线，默认 70 |

| 输出 | 说明 |
|------|------|
| `overall_score` | 总分 0–100 |
| `score_detail` | JSON 四维度分 |
| `feedback` | 中文评语 |
| `pass` | 是否及格 |

---

## 销量预测智能体

| 文件 | 说明 |
|------|------|
| `sales-forecast-agent.yml` | 上传销售月报 CSV → ABCD 分类 → 预测/回测 → 备货建议 → LLM 报告 |

设计来源：`docs/samples/xiaoshou/yuce/1.python`

### 导入步骤

1. Dify 控制台 → **工作室** → **导入 DSL**
2. 选择 `sales-forecast-agent.yml`
3. 若 LLM 节点报红，将模型改为你实例已安装的提供商（如 DeepSeek / OpenAI）
4. 试运行：上传 CSV，`base_yearmonth` 设为近 1 月对应年月

### 输入变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `file` | — | 销售月报 CSV（含「近X月销量」列） |
| `mode` | `predict` | `predict` 预测未来 / `backtest` 回测验证 |
| `base_yearmonth` | `2026-06` | 近 1 月对应年月 |
| `forecast_months` | `6` | 预测月数 |
| `safety_stock_a/b/c/d` | 1.15/1.25/1.30/1.50 | 各类安全系数 |

### 输出变量

- `report` — LLM 决策报告
- `stocking_plan` — 备货计划 JSON
- `accuracy` — 回测精度报告
- `is_pass` — A 类是否达标（PASS/FAIL/N/A）
- `classification` — ABCD 分类摘要

### 注意事项

- 预测节点使用 **pandas/numpy**（无 statsmodels），适配 Dify 代码沙箱
- SKU 超过约 5000 时可能触发超时，建议分批或改调妙搭 `walkforward` API
- 高精度场景见 `docs/samples/forecast-backtest/README.md`
