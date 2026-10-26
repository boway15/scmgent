# Task 2 Report: 规则框架核心（参数描述 + 分层解析）

## 实现摘要

在 `apps/web/server/rules/core/` 新增纯函数规则核心库，未改动数据库、补货任务或 UI。

| 文件 | 职责 |
|------|------|
| `param.ts` | `ParamSpec` / `ParamSchema` 类型、`defaultsOf`、`checkParamValue`、`validateParamPatch` |
| `resolve.ts` | `SCOPE_PRIORITY` 分层解析、`resolveParams`、作用域上下文与 `ParamSource` 溯源 |
| `define.ts` | `RuleTraceItem`、`RuleModuleMeta`、`defineRuleModule`（恒等元数据注册） |
| `param.test.ts` | 默认值与 patch 校验 |
| `resolve.test.ts` | 无集默认、按 key 覆盖、忽略不匹配 scope、跳过非法/未知键 |

导出名称与类型与 task brief 一致，供后续任务导入。

## TDD：RED / GREEN

### Step 2 — param RED

```text
pnpm --filter @scm/web exec tsx --test server/rules/core/param.test.ts
```

结果：`ERR_MODULE_NOT_FOUND`（无法找到 `./param.js`），测试套件 fail 1。

### Step 4 — param GREEN

同上命令。

结果：`fail 0`，4 tests pass（defaultsOf ×1，validateParamPatch ×3）。

### Step 6 — resolve RED（预期）

在仅存在 `resolve.test.ts`、无 `resolve.ts` 时，预期与 param 相同为 `ERR_MODULE_NOT_FOUND`。实现 `resolve.ts` 前应按 brief 先跑失败；本任务在写入 `resolve.test.ts` 后于同轮次完成 `resolve.ts`/`define.ts`，随后验证通过。

### Step 8 — 全量 GREEN

```text
pnpm --filter @scm/web exec tsx --test server/rules/core/param.test.ts server/rules/core/resolve.test.ts
```

结果：

```text
ℹ tests 8
ℹ pass 8
ℹ fail 0
```

## 变更文件

- `apps/web/server/rules/core/param.ts`（新建）
- `apps/web/server/rules/core/param.test.ts`（新建）
- `apps/web/server/rules/core/resolve.ts`（新建）
- `apps/web/server/rules/core/resolve.test.ts`（新建）
- `apps/web/server/rules/core/define.ts`（新建）

## Commit

- SHA: `c382478bf29289dcff289a9f0d344942ea86303d`
- Subject: `feat(rules): param schema, layered resolver and module definition`

## 自检

- [x] 代码与 brief 片段一致（含中文错误文案、`GLOBAL_SCOPE_VALUE`、`checkParamValue` 导出供 resolve 复用）。
- [x] `resolveParams` 按 `SCOPE_PRIORITY` 从低到高叠加，同 key 后层覆盖；无效值与 schema 外键跳过；`paramSetIds` 为实际贡献参数的 set id 集合。
- [x] 测试断言与 brief 一致（含 `paramSetIds.sort()` 与 DE 仓 invalid coverDays 回退 global 40）。
- [x] 仅 `git add apps/web/server/rules/core`，未纳入 `.tmp-*` 等无关文件。
- [ ] `define.ts` / `defineRuleModule` 暂无单测（brief 未要求）；后续模块任务应覆盖。
- [ ] 未新增 barrel `index.ts`（brief 未要求）；调用方按 `./param.js`、`./resolve.js`、`./define.js` 直接导入。

## 关注点

- `paramSetIds` 顺序依赖 `Set` 插入顺序（SCOPE_PRIORITY 遍历顺序），测试用 `.sort()` 比较；若产品需要稳定展示顺序，后续可显式排序。
- 同 scope 多条 `ActiveParamSet` 时 `sets.find` 取第一条；DB 层应保证同 scope 唯一或后续任务定义合并策略。
