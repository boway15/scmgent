# P0 生产冒烟验收清单

上线前按本清单逐项验收，确保从演示 MVP 升级到业务可用。

## 1. 运行状态

- [ ] `GET /api/health` 返回 JSON，`db: connected`
- [ ] `runtime.authDevMode` 为 `false`（生产环境）
- [ ] `runtime.serveStatic` 为 `false`（妙搭）
- [ ] `runtime.cronSecretConfigured` 为 `true`
- [ ] `runtime.productionReady` 为 `true`
- [ ] `runtime.warnings` 无阻断项

## 2. 鉴权与菜单

- [ ] `/api/auth/config` 返回 JSON（非 HTML）
- [ ] 飞书登录或生产账号可登录
- [ ] 5 种角色菜单符合权限矩阵
- [ ] `ENFORCE_RBAC=true` 时无菜单权限无法访问 API

## 3. 数据导入

- [ ] 库存/销量 preview 可展示校验错误
- [ ] 非法 SKU、仓码、日期在 preview 阶段可见
- [ ] 导入成功后 `import_batches` 有记录
- [ ] 看板展示库存/销量最新日期

## 4. PMC 到货闭环

- [ ] 已确认计划可「确认到货」
- [ ] 到货后 `completed_qty` 增加
- [ ] 库存总览对应 SKU+仓有效供给变化
- [ ] 重复提交相同 idempotencyKey 不重复入库
- [ ] 全部行到货后计划状态可变为 `completed`

## 5. 自动化任务

- [ ] `POST /api/tasks/replenishment-forecast`（带 `X-Cron-Secret`）成功
- [ ] `POST /api/tasks/stock-alert` 成功
- [ ] `task_runs` 记录执行时间与结果
- [ ] 看板展示最近一次补货/预警任务状态

## 6. 妙搭专项

- [ ] 已执行 `miaoda-init-all.sql`
- [ ] `ScmHonoModule` 在 `ViewModule` 之前
- [ ] 应用内 F12：`/api/me` 200
- [ ] 子路径下前端 API 正常（含 `/app/app_xxx`）
