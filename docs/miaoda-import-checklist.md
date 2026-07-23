# 飞书妙搭（秒搭）导入清单

> **命名**：「飞书秒搭」即官方产品 **飞书妙搭（Miaoda）**。  
> **重要**：ZIP **仅能在新建应用时导入**；已创建项目不可重新导入，只能在线改代码或新建应用。  
> 导入后平台套 **NestJS 全栈外壳**；业务 Hono 须在 **`server/hono-app/`**（参与 `nest build`），经 **`ScmHonoModule`** 挂载。`source_package/` 不参与编译。

---

## 避坑速查（优先读）

### 五大根因（「服务不可用」/ `/api/auth/config` 失败）

| # | 根因 | 现象 | 处理 |
|---|------|------|------|
| 1 | `ScmHonoModule` 未注册 | 响应为 **HTML**（View fallback） | `app.module.ts` 注册，**在 ViewModule 之前** |
| 2 | 模块不在编译范围 | 无 `SCM Hono mounted` 日志 | 放 `server/modules/scm-hono/`，非 `source_package/` |
| 3 | 根 `packages/db/` 缺失 | `@scm/db` 解析失败 | 复制到根 `packages/db/`，`npm install` |
| 4 | `import.meta.url` ESM/CJS | `import.meta is not defined` | hono-app 入口改 CJS `__dirname` |
| 5 | Hono 不在 `dist/` | `Hono entry not found` | 业务在 `server/hono-app/`，非 `source_package/server/` |

### 其他常见问题

| 优先级 | 现象 | 根因 | 处理 |
|:------:|------|------|------|
| P0 | Network URL 无 `/app/app_xxx` | 前端子路径未适配 | `apiUrl()` + vite `base` + Router basename |
| P0 | Hono 已挂仍 404 | 后端缺 basePath | `server/hono-app/index.ts` 设 `CLIENT_BASE_PATH` |
| P0 | 页面有数据但不请求 `/api/*` | 妙搭自动迁移把真实 API 改成 Mock | 跑 `miaoda-sync-to-server.js` 覆盖并做反 Mock 校验 |
| P0 | `/api/auth/config` 503 且 import 报 TS 语法 | Hono `routes/lib/_db` 未转译为 ESM JS | 使用最新 ZIP；确认日志含 `route/lib/_db .js` |
| P1 | 「服务不可用」 | 上列任一 + config 请求非 JSON | 按 `apps/web/miaoda/hono-app-checklist.md` |
| P1 | 菜单空 / 无 admin | 未 seed | `miaoda-init-all.sql` |
| P2 | 地址栏开 API → CSRF 403 | 平台网关 | 应用内 F12 Network |
| P2 | `SERVE_STATIC=true` | 反模式 | 妙搭用 **`false`** |
| P2 | `AUTH_DEV_MOD` | 拼写错 | `AUTH_DEV_MODE` |

**本地 Docker 会自动 migrate + seed；妙搭不会**，管理员须在 SQL 控制台一次性执行迁移 + seed。

**验证 API**：应用内 F12 → `/api/auth/config` **200 JSON**（非 HTML）、`/api/me` 200、`/api/health` 含 `db: connected`。

---

## 〇、妙搭 vs 本地 Docker（架构对照）

| 项 | 本地 Docker / `pnpm dev` | 妙搭导入后 |
|----|---------------------------|------------|
| 进程入口 | `tsx server/index.ts`（ESM） | `dist/server/main.js`（NestJS CJS，**勿改 main.ts**） |
| 业务 API | `apps/web/server/index.ts` | **`server/hono-app/index.ts`** + **ScmHonoModule** |
| 编译范围 | tsx 直接跑 `.ts` | **`nest build` 只编 `server/**/*`** |
| 前端 | `src/` → Vite 5173 | `client/` → `dist/client`（NestJS 渲染） |
| 静态资源 | `SERVE_STATIC=true` 时 Hono 托管 | **`SERVE_STATIC=false`**，NestJS 托管 |
| 应用 URL | `http://localhost:8081` | `https://xxx/app/app_{id}`（**CLIENT_BASE_PATH**） |
| 数据库 | `packages/db`（monorepo） | 根 **`packages/db/`** + `file:./packages/db` |
| 数据库 Seed | `pnpm db:seed` | SQL 控制台 `miaoda-init-all.sql` |

---

## 一、导入前检查

| 项 | 要求 |
|----|------|
| 技术栈 | React 18 + Vite + Hono + PostgreSQL（Drizzle） |
| 数据库方言 | 仅 PostgreSQL，禁止 SQLite/MySQL |
| 持久化 | 不使用本地磁盘存业务数据（`fs` 读写业务文件） |
| AI | MVP 使用**本地 FAQ 助手**，`DIFY_API_KEY_*` 留空 |
| 认证 | 生产必须 `AUTH_DEV_MODE=false` + 飞书 OAuth |
| 依赖体积 | 单包依赖 < 1MB（当前无超标项） |

本地可先跑通再打包：

```bash
pnpm install
docker compose up -d postgres
cp .env.example .env
pnpm db:migrate && pnpm db:seed
pnpm dev
# http://localhost:5173
```

---

## 二、打包 ZIP

```bash
pnpm install
pnpm zip:miaoda
# 产出: apps/web/scm-agent-miaoda.zip
```

### ZIP 内容

| 路径 | 说明 |
|------|------|
| `src/` | 前端（导入后 → `client/`） |
| **`server/hono-app/`** | **CJS Hono 业务**（zip 自动生成，参与 nest build） |
| **`server/modules/scm-hono/`** | **ScmHonoModule**（zip 自动打入） |
| `packages/db/` | 根级 `@scm/db` |
| `drizzle/*.sql` | 含 **miaoda-init-all.sql** |
| `miaoda/` | 现场文档与 snippet |
| `package.json` | `@scm/db`: `file:./packages/db` |

本地 `apps/web/server/`（ESM）**不**打入 ZIP；由 `scripts/miaoda-cjs-transform.js` 转为 hono-app。

### 已排除

`node_modules`、`.git`、`dist`、`.env`、`.env.local`

---

## 三、妙搭导入步骤

1. 登录妙搭 → **新建应用** → **导入 ZIP**（`apps/web/scm-agent-miaoda.zip`）
2. 等待依赖安装 + 首次构建 + 自动迁移结束（约 3–10 分钟）
3. 终端执行 `node source_package/scripts/miaoda-sync-to-server.js`，覆盖平台自动迁移改动
4. 执行 `npm run build:server` 与 `NODE_ENV=production npm run build:client`
5. 做反 Mock、CSRF、Hono import 验证（第三节 D）
6. 配置环境变量（第四节）→ **保存** → **提交代码 → 发布**
7. 第五节：SQL 控制台执行 `miaoda-init-all.sql`
8. 第九节：功能验收

### A. `server/hono-app/` 与 `packages/db/`（P0）

ZIP 已由 `zip:miaoda` 生成 `server/hono-app/`（CJS）与根 `packages/db/`。

| 检查项 | 说明 |
|--------|------|
| hono-app 位置 | 须在平台 **`server/hono-app/`**，非仅 `source_package/` |
| packages/db | 须在**项目根** `packages/db/` |
| CJS | 构建日志无 `import.meta is not defined` |
| npm install | `node_modules/@scm/db` 链到 `packages/db` |

若导入后路径不对，见 `apps/web/miaoda/hono-app-checklist.md` 迁入表。

### B. ScmHonoModule 检查（P0）

| 文件 | 要求 |
|------|------|
| `server/modules/scm-hono/scm-hono.module.ts` | 参考 `miaoda/scm-hono.module.snippet.ts`；candidates 指向 `server/hono-app/` |
| `server/app.module.ts` | `ScmHonoModule` 在 **`ViewModule` 之前**（见 `app-module.snippet.txt`） |
| `server/main.ts` | **不要修改** |

构建日志应出现：`SCM Hono mounted from .../server/hono-app/index.js`

失败排查：`Hono entry not found`（未迁入 hono-app）、`import.meta is not defined`（ESM 未改）、`Failed to mount`（查 `@scm/db`）。

### C. 404 / 响应格式排障

| 响应 | 来源 | 处理 |
|------|------|------|
| **HTML** | ViewController fallback | ScmHonoModule 顺序或未注册 |
| NestJS `Cannot GET /api/...` | 模块注册了但 hono 加载失败 | 查构建日志 Failed to mount |
| `{ "message": "Not Found" }` | Hono 已挂载 | 查路由 / basePath |
| Request URL 缺 `/app/app_xxx` | 前端子路径 | `apiUrl()` + vite base |

### D. 发布前强制验证（P0）

妙搭会自动迁移前端，常见副作用是把真实 API 改成 Mock、移除 `apiFetch` / CSRF、把鉴权改成直通。每次导入后必须等自动任务结束，再运行 sync 和验证：

```bash
npm install --include=dev
node source_package/scripts/miaoda-sync-to-server.js
npm run build:server
NODE_ENV=production npm run build:client
```

发布前执行：

```bash
grep -n '演示用户\|conv-mock\|mock: true\|mockDelay' client/src/lib/api.ts client/src/hooks/useAuth.ts client/src/components/RequireAuth.tsx || echo "OK: no mock runtime"
grep -n 'apiFetch\|x-suda-csrf-token' client/src/lib/base-path.ts
node -e 'import("./dist/server/hono-app/index.js").then(m=>console.log("OK", !!m.default?.fetch)).catch(e=>{console.error(e.stack||e); process.exit(1)})'
```

准出条件：`OK: no mock runtime`；`base-path.ts` 含 `apiFetch` 与 `x-suda-csrf-token`；Hono import 输出 `OK true`；`dist/client/assets/index-*.js` 存在且 `dist/client/index.html` 不含 `@vite/client`。

---

## 四、环境变量

在妙搭「环境变量」中配置（参考 ZIP 内 `.env.example`）：

| 变量 | 必填 | 妙搭建议值 | 说明 |
|------|:----:|------------|------|
| `DATABASE_URL` | — | 平台自动注入 | UI 可能不显示；不支持外网连库时 seed 用 SQL |
| `CLIENT_BASE_PATH` | — | 平台自动 | **勿改**；形如 `/app/app_{id}` |
| `PORT` / `SERVER_PORT` | — | 平台默认 | 一般勿手填 |
| `SERVE_STATIC` | ✅ | **`false`** | NestJS 托管 `dist/client` |
| `AUTH_DEV_MODE` | ✅ | 内测 `true` / 正式 `false` | **勿写错** `AUTH_DEV_MOD` |
| `APP_BASE_URL` | ✅ | `https://xxx/app/app_{id}` | 与浏览器地址一致，无末尾 `/` |
| `JWT_SECRET` | ✅ | 随机长字符串 | 勿用默认值 |
| `FEISHU_APP_ID` | 正式必填 | 飞书自建应用 | 内测可空 |
| `FEISHU_APP_SECRET` | 正式必填 | | |
| `FEISHU_OAUTH_REDIRECT_URI` | 正式必填 | `{APP_BASE_URL}/api/auth/feishu/callback` | |
| `FEISHU_ALERT_CHAT_ID` | — | 群 chat_id | 可选（资讯模块不做群推送） |
| `FEISHU_BITABLE_APP_TOKEN` | 资讯必填 | 多维表格 app_token | 与旧资讯表可同 app |
| `FEISHU_BITABLE_TABLE_NEWS_INTEL` | — | 旧表 table_id | **仅保留历史，禁止新写入** |
| `FEISHU_BITABLE_TABLE_NEWS_INTEL_V2` | 资讯必填 | 新「跨境资讯总表」table_id | 采集只写此表 |
| `NEWS_INTEL_ENABLED` | — | `true` | 设为 `false` 可关闭采集 |
| `RSSHUB_BASE_URL` | 建议 | 自建 RSSHub | rsshub 信源需要 |
| `DIFY_API_KEY_NEWS_INTEL` | 建议 | Dify 工作流 key | 英文官方中文化；缺失时中文源仍可规则入库 |
| `DIFY_*` | — | 留空 | 其他 Phase 2 |
| `ENFORCE_RBAC` | ✅ | `true` | |
| `CRON_SECRET` | ✅ | 随机长字符串 | Header `X-Cron-Secret` |

> **内测**：`AUTH_DEV_MODE=true` 自动 `admin@scm.local`，不可用于生产。

---

## 五、数据库初始化

### 5.1 执行迁移 SQL

在妙搭「数据库」→ SQL 执行，**按序号依次**运行 ZIP 内 `drizzle/` 文件：

```
0000_naive_cyclops.sql
0001_purchase_drafts.sql
0002_fob_settlement.sql
0003_plan_merchant_inventory.sql
0004_remove_pmc_import_menu.sql
0005_warehouses_multichannel.sql
0006_product_master_data.sql
0007_product_master_menu.sql
0008_stock_alerts_warehouse.sql
0009_dashboard_compliance_menus.sql
0010_replenish_light.sql
0011_spu_moq.sql
0011_help_center_menu.sql
0012_fob_multi_allocation.sql
```

每条执行成功后再跑下一条。`0004`、`0007`、`0009` 含菜单增量修正，**不能跳过**。  
`0011_help_center_menu.sql` 为手工补丁（不在 Drizzle journal 内），须在 `0011_spu_moq.sql` 之后执行。  
`patch_furniture_names.sql` 为可选演示数据补丁，按需执行。

### 5.2 执行 Seed（角色 / 菜单 / 管理员 / FOB 规则）

**推荐（妙搭 SQL 控制台，无外网连库）**：

1. `drizzle/miaoda-seed-roles-menus.sql`（角色、菜单、admin@scm.local）
2. `drizzle/seed-fob-fee-rules.sql`（FOB 分摊规则 ~75 条）

重新生成 roles/menus SQL（本地改 seed.ts 后）：

```bash
pnpm db:seed:sql
# 产出 docs/sql/miaoda-seed-roles-menus.sql → 随 zip:miaoda 打入 drizzle/
```

**备选（本地能连妙搭 PG 时）**：

```bash
# .env 写入妙搭 DATABASE_URL
pnpm db:seed
# 再于 SQL 控制台执行 seed-fob-fee-rules.sql
```

### 5.3 验证表与菜单

- [ ] 核心表存在：`users`、`roles`、`menus`、`role_menus`、`skus`、`inventory_records`、`sales_history`、`pmc_plans`、`purchase_drafts`、`news_sources`、`news_articles` 等
- [ ] `menus` 含 `dashboard`、`data.sales`、`pmc.tracking`、`intel.news`（仅 super_admin）
- [ ] 无废弃菜单：`pmc.drafts`、`pmc.import`、`reorder.*`

---

## 六、飞书开放平台配置

1. 创建**企业自建应用**，开通权限：
   - 获取用户身份信息
   - 以应用身份发消息（预警推送需要）
2. **重定向 URL** 添加：
   ```
   {APP_BASE_URL}/api/auth/feishu/callback
   ```
3. 将 `App ID`、`App Secret` 填入妙搭环境变量
4. 发布应用版本并使员工可用
5. 在 SCM「系统设置 → 用户管理」为飞书用户分配角色

---

## 七、自动化任务

发布应用后，在妙搭「自动化任务」中配置：

| 任务名 | Cron | 执行文件 | 手动调试 API |
|--------|------|----------|--------------|
| 缺货预警 | `0 7 * * *`（每天 07:00） | `server/tasks/stockAlert.ts` | `POST /api/tasks/stock-alert` |
| 补货预测 | `0 6 * * 1`（每周一 06:00） | `server/tasks/replenishmentForecast.ts` | `POST /api/tasks/replenishment-forecast` |
| 跨境资讯采集 | `0 8 * * *`（每天 08:00） | `server/tasks/newsIngest.ts` | `POST /api/tasks/news-ingest` |
| 大件备货从飞书拉取 | `0 8 * * *`（每天 08:00） | `server/tasks/procurementFeishuPull.ts` | `POST /api/tasks/procurement-bulk-stock-pull` |
| 采购跟单从飞书拉取 | `0 8 * * *`（每天 08:00） | `server/tasks/procurementFeishuPull.ts` | `POST /api/tasks/procurement-follow-up-pull` |

手动调试或 HTTP 插件调用时，请求头必须带：

```
X-Cron-Secret: {与 CRON_SECRET 环境变量相同的值}
```

流程：

1. 先 **发布应用**
2. 配置 `CRON_SECRET` 环境变量
3. 创建任务 → 选手动触发（附带 `X-Cron-Secret`）→ 确认日志无报错
4. 再启用 Cron
5. 配置 `FEISHU_ALERT_CHAT_ID` 后，预警任务可向飞书群推送

---

## 八、演示数据导入（可选）

仓库示例 CSV：`docs/samples/import/`（本地路径，不随 ZIP 打包，可按内容手工粘贴）。

**必须按顺序导入**（SKU 最先）：

| 顺序 | 文件 | 导入类型 | 验证页面 |
|:----:|------|----------|----------|
| 1 | `01-skus.csv` | SKU 主数据 | 商品主数据 / 库存总览 |
| 2 | `02-inventory.csv` | 库存盘点 | 库存总览 |
| 3 | `03-sales.csv` | 销量历史 | 销量历史 / 补货建议 |
| 4 | `04-safety_stock.csv` | 安全库存 | 安全库存 / 缺货预警 |
| 5 | `05-pmc_plans.csv` | 下单计划 | PMC 计划列表 |
| 6 | — | SKU 合规 | 合规总览 / SKU 合规 |

PMC 计划上传时额外填写：计划名称、计划日期、交期、商家编号。

合规 CSV 列：`sku_code, hs_code, origin_country, declared_value, weight_kg, length_cm, width_cm, height_cm, battery_type, is_liquid`

---

## 九、功能验收清单

### 9.0 安全验收（迭代 5）

- [ ] `AUTH_DEV_MODE=false`，`ENFORCE_RBAC=true`
- [ ] `CRON_SECRET` 已配置且非默认值
- [ ] 无 `X-Cron-Secret` 调用 `POST /api/tasks/stock-alert` → 401
- [ ] `viewer` 角色调用 `PUT /api/skus/:id/compliance` → 403（无 `compliance.skus` 菜单）
- [ ] 上传超过 10MB 文件至 `/api/import/inventory` → 400
- [ ] 非 super_admin 调用 `GET /api/roles` → 403

### 9.1 基础连通

- [ ] 访问 `/` 自动跳转 `/dashboard`
- [ ] `GET /api/health` → `{ "status": "ok" }`
- [ ] 飞书登录成功，`GET /api/me` 返回当前用户
- [ ] `GET /api/me/menus` 返回树形菜单（含经营看板）
- [ ] 侧边栏菜单与角色权限一致

### 9.2 经营看板 `/dashboard`

- [ ] KPI 卡片有数据（或零值正常展示）
- [ ] 「今日待办」链接可跳转对应页面
- [ ] 快捷入口可用

### 9.3 数据中心

- [ ] 商品主数据：SPU/SKU/商家 CRUD
- [ ] 数据导入：6 种类型均可上传 CSV
- [ ] 销量历史：按 SKU / 日期 / 渠道 / 仓筛选

### 9.4 库存管理

- [ ] 同一 SKU 两仓可独立配置安全库存（迭代 6）
- [ ] 缺货预警记录含 `warehouse_code` 字段
- [ ] 库存总览：多仓数量展示
- [ ] 库存总览「问 AI」跳转 `/ai/chat?sku=...`
- [ ] 安全库存：手动设置 + EOQ 计算
- [ ] 缺货预警：摘要 + 跳转补货建议
- [ ] 补货建议：展开「查看依据」显示 reason

### 9.5 下单计划（PMC）

- [ ] 补货建议：本地预测 + PMC 计划合并
- [ ] 计划列表：创建 / 确认 / 状态流转
- [ ] 计划详情：`GET /api/pmc/plans/:id/export` 导出 CSV
- [ ] 采购跟单：待跟进 / 已跟进（**非正式采购单**）
- [ ] `/pmc/drafts` 重定向至 `/pmc/tracking`

### 9.6 合规管理

- [ ] 合规总览：完整 / 部分 / 缺失统计
- [ ] SKU 合规：编辑保存、`GET/PUT /api/skus/:id/compliance`
- [ ] 商品主数据列表展示合规状态标签

### 9.7 物流 / AI / 系统

- [ ] FOB 分账：创建账单、解析、分摊明细
- [ ] AI 助手：`GET /api/ai/config` → `mode: "local"`
- [ ] AI 对话可创建会话、收发消息（本地 FAQ）
- [ ] 角色管理：勾选菜单保存后刷新生效
- [ ] 用户管理：分配角色

### 9.8 定时任务

- [ ] `POST /api/tasks/stock-alert` 手动触发成功
- [ ] `POST /api/tasks/replenishment-forecast` 手动触发成功
- [ ] （可选）飞书群收到预警消息

---

## 十、菜单与路由对照

登录后默认首页：**经营看板** `/dashboard`

| 菜单 | 路由 | 角色可见（预设） |
|------|------|------------------|
| 经营看板 | `/dashboard` | 全部 |
| 库存总览 | `/inventory/overview` | 全部 |
| 安全库存设置 | `/inventory/safety` | super_admin, pmc_planner, purchaser |
| 缺货预警 | `/inventory/alerts` | super_admin, warehouse, purchaser |
| 补货建议 | `/pmc/suggestions` | super_admin, pmc_planner, viewer |
| 计划列表 | `/pmc/list` | 除 viewer 外大部分 |
| 采购跟单 | `/pmc/tracking` | super_admin, purchaser, viewer |
| 合规总览 | `/compliance/overview` | 全部 |
| SKU 合规 | `/compliance/skus` | 全部 |
| FOB 分账 | `/logistics/fob-settlement` | 除纯 viewer 受限角色外 |
| 知识问答 | `/ai/chat` | 全部 |
| 商品主数据 | `/data/products` | super_admin, pmc_planner, warehouse, purchaser |
| 数据导入 | `/data/import` | 同上 |
| 销量历史 | `/data/sales` | 全部 |
| 用户/角色/菜单 | `/system/*` | super_admin |

---

## 十一、常见问题

### A. 已建项目不能重新导入 ZIP

在妙搭编辑器按下列路径同步本地最新文件，然后构建发布：

| 妙搭 | 本地 |
|------|------|
| `server/hono-app/` | `apps/web/server/`（迁入后做 CJS 适配） |
| `server/modules/scm-hono/scm-hono.module.ts` | `apps/web/miaoda/scm-hono.module.snippet.ts` |
| `packages/db/` | `packages/db/`（根级） |
| `client/src/lib/base-path.ts`、`api.ts`、`App.tsx` | `apps/web/src/` 同名 |
| `client/src/components/RequireAuth.tsx` | 同名 |
| `server/app.module.ts` | `ScmHonoModule` 在 `ViewModule` **之前** |

### B. 现象对照表

| 现象 | 根因 | 处理 |
|------|------|------|
| 「服务不可用」 | `/api/auth/config` 非 JSON（常为 HTML） | hono-app 迁入 + ScmHonoModule 在 ViewModule 前 |
| `/api/*` 返回 HTML | View fallback 先于 Hono | 调整 `app.module.ts` imports 顺序 |
| `/api/*` 404 `Cannot GET /app/...` | hono 入口加载失败 | 查 `Failed to mount`；CJS / @scm/db |
| `import.meta is not defined` | ESM 语法在 CJS 产物中 | hono-app 删 `import.meta.url` |
| `Hono entry not found` | 业务仍在 `source_package/` | 迁入 `server/hono-app/` |
| 永久「加载中...」 | 旧版 RequireAuth | 同步 `RequireAuth.tsx` 错误态 |
| 浏览器直接访问 `/api/health` CSRF 403 | 平台网关 | 应用内 F12 → Network |
| 应用内 `/api/auth/config` **403** `csrf token not found` | 妙搭 CSRF 网关 | 同步 `fetch-api.ts`，请求带 `x-suda-csrf-token` |
| 应用内 `/api/auth/config` **403**（其他） | 请求 URL 缺 `/app/app_xxx` | 更新 `base-path.ts` 运行时推断 |
| `AUTH_DEV_MOD` 无效 | 变量名拼写错误 | 必须 `AUTH_DEV_MODE` |
| `/api/health` db:error | PG 未绑定或 env 未注入 | 启用内置 PG；`DATABASE_URL` |
| 构建无 `SCM Hono mounted` | 模块未注册或未编译 | `server/modules/scm-hono/` + app.module |
| 侧边栏缺菜单 | seed 未跑 | `miaoda-init-all.sql` |
| 页面 404 但 API 200 | 前端未适配 CLIENT_BASE_PATH | `base-path.ts` / vite base |
| FOB 分摊规则为空 | 未跑 FOB seed | 含在 `miaoda-init-all.sql` |

---

## 十二、本期不做 / 后续 Phase

| 项 | 状态 |
|----|------|
| 正式采购单 / PO 审批 | 不做 |
| BOM / 物料需求 | 不做 |
| Dify RAG / Workflow | 预留，见 [dify-integration-readiness.md](dify-integration-readiness.md) |
| 合规规则库 + Agent | 后续 |
| ERP / WMS API | 不做 |
| 物流在途追踪 | 后续 |

---

## 十三、相关文档

- [README.md](../README.md) — 本地开发与模块总览
- [miaoda-new-app-release.md](miaoda-new-app-release.md) — 新建应用发布 SOP
- [apps/web/miaoda/hono-app-checklist.md](../apps/web/miaoda/hono-app-checklist.md) — Hono 迁入与五大根因
- [apps/web/miaoda/MIAODA-SETUP.md](../apps/web/miaoda/MIAODA-SETUP.md) — 现场 5 步速查
- [docs/prd/mvp-overview.md](prd/mvp-overview.md) — MVP 范围与迭代记录
- [docs/samples/import/README.md](samples/import/README.md) — 演示 CSV 说明
- [.cursor/skills/feishu-miaoda/SKILL.md](../.cursor/skills/feishu-miaoda/SKILL.md) — 妙搭架构与避坑
