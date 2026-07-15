---
name: dify-cs-email-draft
description: >-
  Dify Workflow DSL 导入结构规范（独立站智能客服草稿工作流）。仅约束 YAML 骨架、节点类型、
  边连接、变量引用与 outputs 声明，防止导入失败或画布打不开。Use when generating or
  validating Dify workflow YAML/DSL export for import, not for business prompt content.
---

# Dify Workflow · 导入结构规范

> **范围**：只规定 DSL **骨架与连线**，不写 Prompt 正文、Gateway 业务逻辑、ERP 字段含义。
> 内容（文案、规则、接口实现）导入后于 Dify 控制台单独维护。

## 应用顶层

```yaml
kind: app
version: 0.6.0          # 与目标 Dify 实例版本对齐
app:
  mode: workflow        # 非 advanced-chat / agent-chat
  name: <应用名>
  description: <简述>
dependencies:           # 模型插件；缺失会导致导入后 LLM 节点报错
  - type: marketplace
    value:
      marketplace_plugin_unique_identifier: langgenius/deepseek:0.0.15@<commit>
workflow:
  environment_variables: []
  conversation_variables: []
  features: { ... }     # 保留默认块，勿删键
  graph:
    edges: []
    nodes: []
```

**导入失败常见根因（顶层）**：

| 现象 | 结构原因 |
|------|----------|
| 导入直接失败 | `kind`/`version` 缺失或与实例不兼容 |
| 打开后 LLM 红叉 | `dependencies` 未声明或插件未安装 |
| 画布空白 | `graph.nodes` / `graph.edges` 为空或 JSON 非法 |

## 节点清单（12 个，id 固定）

生成 DSL 时 **node.id 必须与下表一致**，否则 `value_selector` 与 `edges` 全部失效。

| id | type | 说明 |
|----|------|------|
| `start` | start | 4 个输入变量 |
| `fetch_email_context` | http-request | HTTP #1 |
| `normalize_email_context` | code | 归一化 HTTP #1 |
| `judge_has_order_no` | if-else | 分支 |
| `fetch_order_info` | http-request | HTTP #2（true 支） |
| `normalize_order_info` | code | 归一化 HTTP #2 |
| `generate_reply_draft` | llm | LLM #1（true 支） |
| `parse_reply_output` | code | 解析 LLM #1 |
| `generate_completion_draft` | llm | LLM #2（false 支） |
| `parse_completion_output` | code | 解析 LLM #2 |
| `end` | end | 9 个输出变量 |

## 边连接（10 条，sourceHandle 勿改）

```
start                    → fetch_email_context
fetch_email_context      → normalize_email_context
normalize_email_context  → judge_has_order_no
judge_has_order_no       → fetch_order_info          [sourceHandle: 'true']
judge_has_order_no       → generate_completion_draft [sourceHandle: 'false']
fetch_order_info         → normalize_order_info
normalize_order_info     → generate_reply_draft
generate_reply_draft     → parse_reply_output
parse_reply_output       → end
generate_completion_draft → parse_completion_output
parse_completion_output  → end
```

每条 `edge` 必填：`id`、`source`、`target`、`sourceHandle`、`targetHandle: target`、`type: custom`，以及 `data.sourceType` / `data.targetType`。

## 环境变量块结构

```yaml
environment_variables:
  - id: <uuid>                    # 必填，导入校验
    name: gateway_url
    value: <默认 URL>
    value_type: string
    selector: [env, gateway_url]
    description: <说明>
```

LLM / HTTP 引用：`{{#env.gateway_url#}}`（不是 `{{gateway_url}}`）。

## 开始节点 variables 结构

| variable | type | required |
|----------|------|:--------:|
| `email_id` | text-input | true |
| `gateway_api_key` | text-input | true |
| `max_search_depth` | text-input | false |
| `guidance` | paragraph | false |

每项需：`label`、`max_length`、`options: []`。

## HTTP 节点结构要点

```yaml
type: http-request
authorization: { type: no-auth }
method: get
url: '{{#env.gateway_url#}}'
headers: "x-api-key:{{#start.gateway_api_key#}}"   # 单行 key:value，多 header 用 \n 分隔
params: |                                            # 多行 key:value，勿用 JSON body
  action:<action_name>
  <param>:{{#<node>.<var>#}}
body: { type: none, data: [] }
error_strategy: fail-branch                          # 必须，配合下游 Code 吃 error 字段
retry_config: { retry_enabled: true, max_retries: 3, retry_interval: 1000 }
timeout: { max_connect_timeout: 10, max_read_timeout: 30, max_write_timeout: 30 }
ssl_verify: true
```

**导入/打开注意**：`params` 用 Dify 多行 `key:value` 格式，不要写成 query string 或 JSON。

## Code 节点结构要点

```yaml
type: code
code_language: python3
error_strategy: fail-branch
code: |
  def main(...) -> dict:
      return { "<key>": <value>, ... }
outputs:
  <key>:
    type: string | boolean | number | object
    children: null
variables:
  - variable: body
    value_selector: [<上游节点id>, body]
  - variable: error_message
    value_selector: [<上游http节点id>, error_message]
  - variable: error_type
    value_selector: [<上游http节点id>, error_type]
```

**硬性规则**：

1. `main()` 返回的 **每个 key** 必须在 `outputs` 里声明，且 **type 一致**
2. `outputs` 里的 key **不能多于** `main()` 返回值（否则运行报错）
3. 归一化 Code（接 HTTP）：inputs 必须含 `body`、`error_message`、`error_type`
4. 解析 Code（接 LLM）：input 为 `text`，`value_selector: [<llm节点id>, text]`
5. `code` 内勿用 Dify 不支持的第三方库

### 各 Code 节点 outputs 键名（固定）

**normalize_email_context**：`ok`(boolean)、`error_message`、`error_type`、`email_id`、`email_subject`、`email_body`、`email_attachments`、`from_address`、`from_name`、`extracted_order_no`、`order_source`、`search_depth`（均 string，除 ok）

**normalize_order_info**：`found`(boolean)、`error_message`、`error_type`、`order_no`、`customer_name`、`product_name`、`status`、`currency`、`amount`、`placed_at`、`tracking_url`、`shipping_status`、`tracking_no`

**parse_reply_output / parse_completion_output**：`intent_analysis`、`draft_reply`（string）

## if-else 节点结构

```yaml
type: if-else
cases:
  - id: 'true'
    case_id: 'true'
    logical_operator: and
    conditions:
      - id: <uuid>
        varType: string
        comparison_operator: not empty
        variable_selector: [normalize_email_context, extracted_order_no]
```

`false` 支无需单独 case，由 `sourceHandle: 'false'` 边引出。

## LLM 节点结构要点

```yaml
type: llm
context: { enabled: false, variable_selector: [] }
vision: { enabled: false }
model:
  mode: chat
  provider: langgenius/deepseek/deepseek
  name: deepseek-v4-flash
  completion_params: { temperature: 0.55, max_tokens: <800|500> }
prompt_template:
  - id: <uuid>
    role: system
    text: "<Prompt 正文，结构规范不管内容>"
  - id: <uuid>
    role: user
    text: "<用户轮，可引用 {{#start.guidance#}} 等>"
```

**导入注意**：

- `prompt_template` 每项必须有唯一 `id`
- 变量引用统一 `{{#<节点id>.<变量名>#}}`
- `context.enabled: false` 避免依赖未配置的知识库

## 结束节点 outputs 结构

结束节点 **必须映射 9 个变量**；双分支各有一套 intent/draft，未执行支输出为空：

| 输出 variable | value_selector |
|---------------|----------------|
| `email_id` | `[normalize_email_context, email_id]` |
| `order_no` | `[normalize_email_context, extracted_order_no]` |
| `order_found` | `[normalize_order_info, found]` |
| `search_depth` | `[normalize_email_context, search_depth]` |
| `order_source` | `[normalize_email_context, order_source]` |
| `intent_analysis` | `[parse_reply_output, intent_analysis]` |
| `draft_reply` | `[parse_reply_output, draft_reply]` |
| `completion_intent_analysis` | `[parse_completion_output, intent_analysis]` |
| `completion_draft_reply` | `[parse_completion_output, draft_reply]` |

> false 支不经过 `normalize_order_info` 时，`order_found` 仍指向该节点——Dify 允许，运行值为空/false。

## 节点画布元数据

每个 node 还需（导入 DSL 通常要求）：

```yaml
id: <见清单>
type: custom
width: 242
height: <按节点类型>
position: { x: <number>, y: <number> }
positionAbsolute: { x: <number>, y: <number> }   # 与 position 保持一致
sourcePosition: right
targetPosition: left
selected: false
```

## 变量引用速查

| 写法 | 含义 |
|------|------|
| `{{#start.email_id#}}` | 开始节点输入 |
| `{{#env.gateway_url#}}` | 环境变量 |
| `{{#normalize_email_context.extracted_order_no#}}` | 上游 Code 输出 |
| `{{#fetch_email_context.body#}}` | HTTP 响应体（仅 Code 节点 variables 引用，少在 Prompt 直接用） |

**禁止**：`{{start.email_id}}`（缺 `#`）、引用不存在的 node.id 或 output key。

## 导入前检查清单

```
[ ] kind: app + version 与目标 Dify 一致
[ ] dependencies 含 deepseek 插件标识
[ ] 12 个 node.id 与本文一致
[ ] 10 条 edge 的 source/target/sourceHandle 正确
[ ] 环境变量 gateway_url 含 id + selector
[ ] 2 个 HTTP：fail-branch、headers、params 多行格式
[ ] 4 个 Code：outputs 键与 main() 返回一致；HTTP 下游含 error_* 输入
[ ] if-else 条件指向 normalize_email_context.extracted_order_no
[ ] 2 个 LLM：prompt_template 每项有 id；context.enabled: false
[ ] end 节点 9 个 outputs 的 value_selector 路径有效
[ ] 无非法 YAML（Prompt 内注意转义引号）
```

## 生成源码时分工

| 产出 | 技能是否约束 |
|------|:------------:|
| DSL 骨架 / 节点连线 / outputs 声明 | ✓ |
| Prompt 正文 | ✗ 占位即可 |
| Code 内业务逻辑 | ✗ 可 `pass` 或返回空字符串 |
| Gateway / 妙搭集成 | ✗ 见 [@dify-agent](../dify-agent/SKILL.md) |

完整 YAML 骨架见 [reference.md](reference.md)。
