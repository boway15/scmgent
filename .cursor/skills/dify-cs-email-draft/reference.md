# DSL 骨架模板（仅结构，内容用占位）

## 最小可导入 graph 片段

```yaml
workflow:
  environment_variables:
    - id: b2c3d4e5-f6a7-8901-bcde-f12345678901
      name: gateway_url
      value: https://example.com/dify-gateway
      value_type: string
      selector: [env, gateway_url]
      description: gateway 完整 URL
  graph:
    edges:
      - { id: edge-start-fetch-context, source: start, target: fetch_email_context, sourceHandle: source, targetHandle: target, type: custom, data: { sourceType: start, targetType: http-request, isInIteration: false, isInLoop: false } }
      - { id: edge-fetch-normalize, source: fetch_email_context, target: normalize_email_context, sourceHandle: source, targetHandle: target, type: custom, data: { sourceType: http-request, targetType: code, isInIteration: false, isInLoop: false } }
      - { id: edge-normalize-judge, source: normalize_email_context, target: judge_has_order_no, sourceHandle: source, targetHandle: target, type: custom, data: { sourceType: code, targetType: if-else, isInIteration: false, isInLoop: false } }
      - { id: edge-judge-yes, source: judge_has_order_no, target: fetch_order_info, sourceHandle: 'true', targetHandle: target, type: custom, data: { sourceType: if-else, targetType: http-request, isInIteration: false, isInLoop: false } }
      - { id: edge-judge-no, source: judge_has_order_no, target: generate_completion_draft, sourceHandle: 'false', targetHandle: target, type: custom, data: { sourceType: if-else, targetType: llm, isInIteration: false, isInLoop: false } }
      - { id: edge-order-normalize, source: fetch_order_info, target: normalize_order_info, sourceHandle: source, targetHandle: target, type: custom, data: { sourceType: http-request, targetType: code, isInIteration: false, isInLoop: false } }
      - { id: edge-normalize-order-draft, source: normalize_order_info, target: generate_reply_draft, sourceHandle: source, targetHandle: target, type: custom, data: { sourceType: code, targetType: llm, isInIteration: false, isInLoop: false } }
      - { id: edge-draft-parse, source: generate_reply_draft, target: parse_reply_output, sourceHandle: source, targetHandle: target, type: custom, data: { sourceType: llm, targetType: code, isInIteration: false, isInLoop: false } }
      - { id: edge-parse-end, source: parse_reply_output, target: end, sourceHandle: source, targetHandle: target, type: custom, data: { sourceType: code, targetType: end, isInIteration: false, isInLoop: false } }
      - { id: edge-completion-parse, source: generate_completion_draft, target: parse_completion_output, sourceHandle: source, targetHandle: target, type: custom, data: { sourceType: llm, targetType: code, isInIteration: false, isInLoop: false } }
      - { id: edge-parsecomp-end, source: parse_completion_output, target: end, sourceHandle: source, targetHandle: target, type: custom, data: { sourceType: code, targetType: end, isInIteration: false, isInLoop: false } }
    nodes:
      # 见下方各节点 data 模板
```

## start

```yaml
- id: start
  type: custom
  data:
    type: start
    title: 开始
    variables:
      - { variable: email_id, label: email_id, type: text-input, required: true, max_length: 48, options: [] }
      - { variable: gateway_api_key, label: gateway_api_key, type: text-input, required: true, max_length: 256, options: [] }
      - { variable: max_search_depth, label: max_search_depth, type: text-input, required: false, max_length: 8, options: [] }
      - { variable: guidance, label: guidance, type: paragraph, required: false, max_length: 8000, options: [] }
```

## http-request（×2，仅结构差异在 params）

```yaml
- id: fetch_email_context   # 或 fetch_order_info
  type: custom
  data:
    type: http-request
    title: <标题>
    method: get
    url: '{{#env.gateway_url#}}'
    authorization: { type: no-auth }
    headers: "x-api-key:{{#start.gateway_api_key#}}"
    params: |
      action:<占位>
      <key>:{{#<节点>.<var>#}}
    body: { type: none, data: [] }
    error_strategy: fail-branch
    retry_config: { retry_enabled: true, max_retries: 3, retry_interval: 1000 }
    timeout: { max_connect_timeout: 10, max_read_timeout: 30, max_write_timeout: 30 }
    ssl_verify: true
```

## code · 归一化 HTTP（模板）

```yaml
- id: normalize_email_context   # 或 normalize_order_info
  type: custom
  data:
    type: code
    code_language: python3
    error_strategy: fail-branch
    code: |
      def main(body=None, error_message: str = "", error_type: str = "") -> dict:
          # 占位：返回结构与 outputs 完全一致
          return { "<key>": "" }
    outputs:
      <key>: { type: string, children: null }
    variables:
      - { variable: body, value_selector: [fetch_email_context, body] }
      - { variable: error_message, value_selector: [fetch_email_context, error_message] }
      - { variable: error_type, value_selector: [fetch_email_context, error_type] }
```

`normalize_order_info` 的 `value_selector` 改为 `[fetch_order_info, ...]`。

## code · 解析 LLM（模板）

```yaml
- id: parse_reply_output   # 或 parse_completion_output
  type: custom
  data:
    type: code
    code_language: python3
    error_strategy: fail-branch
    code: |
      def main(text: str) -> dict:
          return { "intent_analysis": "", "draft_reply": "" }
    outputs:
      intent_analysis: { type: string, children: null }
      draft_reply: { type: string, children: null }
    variables:
      - { variable: text, value_selector: [generate_reply_draft, text] }
```

`parse_completion_output` 的 `value_selector` 改为 `[generate_completion_draft, text]`。

## if-else

```yaml
- id: judge_has_order_no
  type: custom
  data:
    type: if-else
    title: 是否找到订单号
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

## llm（×2，仅 title / max_tokens 不同）

```yaml
- id: generate_reply_draft   # 或 generate_completion_draft
  type: custom
  data:
    type: llm
    title: <标题>
    context: { enabled: false, variable_selector: [] }
    vision: { enabled: false }
    model:
      mode: chat
      provider: langgenius/deepseek/deepseek
      name: deepseek-v4-flash
      completion_params: { temperature: 0.55, max_tokens: 800 }
    prompt_template:
      - { id: <uuid>, role: system, text: "PLACEHOLDER_SYSTEM" }
      - { id: <uuid>, role: user, text: "PLACEHOLDER_USER" }
```

## end

```yaml
- id: end
  type: custom
  data:
    type: end
    title: 结束
    outputs:
      - { variable: email_id, value_selector: [normalize_email_context, email_id] }
      - { variable: order_no, value_selector: [normalize_email_context, extracted_order_no] }
      - { variable: order_found, value_selector: [normalize_order_info, found] }
      - { variable: search_depth, value_selector: [normalize_email_context, search_depth] }
      - { variable: order_source, value_selector: [normalize_email_context, order_source] }
      - { variable: intent_analysis, value_selector: [parse_reply_output, intent_analysis] }
      - { variable: draft_reply, value_selector: [parse_reply_output, draft_reply] }
      - { variable: completion_intent_analysis, value_selector: [parse_completion_output, intent_analysis] }
      - { variable: completion_draft_reply, value_selector: [parse_completion_output, draft_reply] }
```

## Code outputs 完整键表（复制用）

**normalize_email_context**

```
ok:boolean, error_message, error_type, email_id, email_subject, email_body,
email_attachments, from_address, from_name, extracted_order_no, order_source, search_depth
```

**normalize_order_info**

```
found:boolean, error_message, error_type, order_no, customer_name, product_name,
status, currency, amount, placed_at, tracking_url, shipping_status, tracking_no
```

**parse_*_output**

```
intent_analysis, draft_reply
```

## 导入后验证（结构）

1. 画布 12 节点、10 连线无孤立节点
2. 点开每个 Code 节点，outputs 列表与代码 return 键一致
3. 点开 end，9 个输出无红色断链
4. 环境变量 `gateway_url` 可编辑
5. 试运行：仅需验证节点可执行，不验证业务结果
