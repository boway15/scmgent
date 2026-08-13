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
