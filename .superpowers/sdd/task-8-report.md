# Task 8：导出、Dify DSL、文档

## 状态

PASS。已实现双工作表成本导出、下载接口与页面 outline「导出」按钮，并更新 Dify DSL 和使用文档。

## 测试

- TDD 红灯：新增测试因 `export-costing.js` 不存在而按预期失败。
- `pnpm exec tsx --test server/lib/product-costing/*.test.ts`：43 tests / 43 pass / 0 fail。
- `pnpm build`：PASS。
- 修改文件 IDE lint：无错误。

## 关注项

- 未配置 `DIFY_API_KEY_COSTING_BOM`，按任务要求跳过样例 PPT 的 Dify 在线实测。
- 全量 `tsc --noEmit` 受仓库既有类型错误影响未通过；本任务测试、生产构建及修改文件 lint 均通过。
- 工作区存在与本任务无关的未提交文件，本次提交仅包含 Task 8 文件。

## Important review findings 修复

- 核实 Dify LLM 原生视觉输入只接受 `File/ArrayFile`，Code 节点无法把
  `pages_json.image_base64` 转成该类型；在工作流说明中记录此 DSL 限制及插件/
  调用端上传方案，避免把空 `variable_selector` 误认为已接入视觉文件。
- 将单图 base64 上限由 120,000 提高到 560,000 字符，覆盖后端最多 400 KiB JPEG。
- 规范化节点对 `origin=template` 强制输出 `qty_net=0`。
- 文档明确 Dify 管理后台 workflow/app 执行超时也必须设置为至少 300 秒，仅配置
  scm-agent `DIFY_WORKFLOW_TIMEOUT_MS=300000` 不足以避免 Dify 侧提前终止。
- 本轮仅修改 YAML/Markdown，未改 TypeScript，按要求未重跑完整 costing 测试套件。
