# scm-agent 妙搭新建应用 · 快速配置（约 10–15 分钟）

> **新建应用 → 导入 ZIP → 等自动迁移结束 → 同步覆盖（必做）→ 构建验证 → 环境变量 → SQL → 发布**

## 架构说明（只读）

妙搭导入后 ZIP 内容在 `source_package/`，平台 `nest build` 只编译根级 `server/**/*`。  
ZIP 已含 `server/hono-app/index.js`（~3.5KB bundled 入口）+ 源码 `.ts`；**同步脚本**复制到平台编译树并 patch `app.module.ts` / `build:server`。

---

## 第 1 步：新建应用并导入 ZIP

1. 妙搭 → **新建应用** → 导入本地 `apps/web/scm-agent-miaoda.zip`（先在本仓库执行 `pnpm zip:miaoda`）
2. **不要立即发布** — 先等待妙搭自动迁移 / 依赖安装 / 首次构建结束，终端回到 prompt
3. 妙搭可能自动把 `api.ts` / `useAuth` 改成 Mock；后续 sync 会覆盖回来

---

## 第 2 步：一键同步（首次导入必做）

在妙搭 **终端** 执行：

```bash
npm install --include=dev
node source_package/scripts/miaoda-sync-to-server.js
npm run build:server
NODE_ENV=production npm run build:client
```

脚本会自动：

| 操作 | 说明 |
|------|------|
| 复制 client | `source_package/client/` → `client/`（覆盖妙搭自动 Mock 迁移） |
| 复制 hono-app | `source_package/server/hono-app/` → `server/hono-app/`（含 **index.js**） |
| 生成 routes/lib/_db JS | 从 `.ts` 转译 Hono 子模块与 vendored DB（ESM） |
| 复制 scm-hono | → `server/modules/scm-hono/` |
| 注册模块 | patch `server/app.module.ts`（`ScmHonoModule` 在 `ViewModule` 前） |
| patch build:server | `nest build && cp -r server/hono-app dist/server/hono-app` |
| patch prebuild | 之后每次构建自动 sync |

验证：

```bash
wc -c server/hono-app/index.js dist/server/hono-app/index.js
# 均应 >3000
grep 'export default' server/hono-app/index.js
grep -n '演示用户\|conv-mock\|mock: true\|mockDelay' client/src/lib/api.ts client/src/hooks/useAuth.ts client/src/components/RequireAuth.tsx || echo "OK: no mock runtime"
grep -n 'apiFetch\|x-suda-csrf-token' client/src/lib/base-path.ts
node -e 'import("./dist/server/hono-app/index.js").then(m=>console.log("OK", !!m.default?.fetch)).catch(e=>{console.error(e.stack||e); process.exit(1)})'
```

构建/验证应出现：

```
OK: no mock runtime
OK true
```

---

## 第 3 步：环境变量

| 变量 | 内测推荐值 |
|------|------------|
| `SERVE_STATIC` | `false` |
| `AUTH_DEV_MODE` | `true` |
| `ENFORCE_RBAC` | `true` |
| `APP_BASE_URL` | `https://你的域名/app/app_xxx` |
| `JWT_SECRET` | 随机长字符串 |
| `CRON_SECRET` | 随机长字符串 |
| `FEISHU_BITABLE_APP_TOKEN` | 多维表格 app_token（资讯） |
| `FEISHU_BITABLE_TABLE_NEWS_INTEL_V2` | 新「跨境资讯总表」table_id |
| `NEWS_INTEL_ENABLED` | `true` |
| `RSSHUB_BASE_URL` | 可选；本地 Docker 已默认 `http://rsshub:1200`。妙搭环境若无自建 RSSHub 可留空（rsshub 信源自动停用，Google 新闻等直连 RSS 仍可用） |
| `DIFY_API_KEY_NEWS_INTEL` | 可选；未配置时英文也可原文入表，中文翻译可在飞书多维表格 AI 字段完成 |

`CLIENT_BASE_PATH`、`DATABASE_URL`、`MIAODA_*` **不要改**。

**保存 → 提交代码 → 发布**。

---

## 第 4 步：数据库

SQL 控制台 → 粘贴 `source_package/drizzle/miaoda-init-all.sql` → 运行。

---

## 验收（应用内 F12）

| 请求 | 期望 |
|------|------|
| `/api/auth/config` | 200 JSON，`devMode: true` |
| `/api/me` | `admin@scm.local` |
| `/api/health` | `db: connected` |

---

## 故障排查

### nest build 报 TS6305 / TS6306（client/*.d.ts、composite）

**常见根因：`tsconfig.node.json` 为空**（`wc -c tsconfig.node.json` 为 0），nest 回退到根 `tsconfig.json` 编译 client。

**一键修复：**

```bash
node source_package/scripts/miaoda-fix-nest-build.cjs
npm run build:server
```

**无 fix 脚本时（当前导入包），直接写入完整 tsconfig.node.json：**

```bash
cat > tsconfig.node.json << 'EOF'
{
  "extends": "@lark-apaas/fullstack-presets/lib/simple/tsconfig/tsconfig.node.json",
  "compilerOptions": {
    "composite": true,
    "baseUrl": "./",
    "outDir": "./dist",
    "paths": {
      "@server/*": ["server/*"],
      "@shared/*": ["shared/*"]
    }
  },
  "watchOptions": {
    "excludeDirectories": ["node_modules/**"]
  },
  "include": ["server/**/*", "shared/**/*.ts"],
  "exclude": [
    "node_modules",
    "dist",
    "client",
    "**/*.spec.ts",
    "**/*.e2e-spec.ts",
    "server/hono-app"
  ]
}
EOF

node -e "
const fs=require('fs');
let r=fs.readFileSync('tsconfig.json','utf8');
r=r.replace(/\"references\"\\s*:\\s*\\[[\\s\\S]*?\\]\\s*,?/m,'');
r=r.replace(/,(\s*[}\]])/g,'\$1');
fs.writeFileSync('tsconfig.json', r.endsWith('\n')?r:r+'\n');
console.log('OK: removed references from tsconfig.json');
"

npm run build:server
```

若仍报 **client/** 类型错误，说明 `nest-cli.json` 也为空，nest 仍用根 `tsconfig.json`：

```bash
wc -c nest-cli.json    # 若为 0，写入：
cat > nest-cli.json << 'EOF'
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "server",
  "compilerOptions": {
    "deleteOutDir": false,
    "tsConfigPath": "tsconfig.node.json"
  }
}
EOF

# 或强制指定 tsconfig（不依赖 nest-cli.json）
NODE_ENV=production npx nest build -p tsconfig.node.json && rm -rf dist/server/hono-app && cp -r server/hono-app dist/server/hono-app
```

诊断：

```bash
wc -c tsconfig.node.json tsconfig.json
grep references tsconfig.json || echo "no references OK"
```

---

### nest build 报 server/hono-app/*.ts 类型错误

`nest build` 误编译了 `server/hono-app`（应在 `tsconfig.node.json` **exclude**）。

```bash
grep -A5 '"exclude"' tsconfig.node.json | grep hono-app || echo "MISSING exclude"
```

在妙搭 IDE 打开 `tsconfig.node.json`，在 `exclude` 数组加入 `"server/hono-app"`（注意 JSON 无尾逗号），或：

```bash
node -e "
const fs=require('fs');
const p='tsconfig.node.json';
let r=fs.readFileSync(p,'utf8');
if(r.includes('server/hono-app')){console.log('already excluded');process.exit(0);}
const n=r.replace(/(\"exclude\"\\s*:\\s*\\[)([\\s\\S]*?)(\\n\\s*\\])/m,(m,o,b,c)=>o+b.trimEnd()+(b.trim()?',':'')+'\\n    \"server/hono-app\"'+c);
if(n===r)throw new Error('could not patch exclude');
fs.writeFileSync(p,n);
console.log('patched tsconfig.node.json');
"
npm run build:server
wc -c dist/server/hono-app/index.js
```

---

### HTTP 503 `SCM Hono is not loaded` / index.js import 报错

`index.js` 与 `routes/*.js` 不同步时（如 `bitableSyncRoutes` export 缺失）：

```bash
node source_package/scripts/miaoda-build-hono-app.cjs
grep bitableSyncRoutes server/hono-app/routes/bitable-sync.js
rm -rf dist/server/hono-app && cp -r server/hono-app dist/server/hono-app
node -e 'import("./dist/server/hono-app/index.js").then(m=>console.log("OK",!!m.default?.fetch)).catch(e=>{console.error(e);process.exit(1)})'
```

其他排查：

1. 是否**导入后先跑 sync**？（最常见）
2. `wc -c server/hono-app/index.js` 是否 ~3500？若 ~200 → 跑 sync 恢复 bundled
3. `grep ScmHonoModule server/app.module.ts` 是否在 `ViewModule` 前
4. `grep build:server package.json` 是否含 `cp -r server/hono-app dist/server/hono-app`

```bash
node source_package/scripts/miaoda-restore-hono-index.cjs
npm run build:server
```

若 `node -e import("./dist/server/hono-app/index.js")` 报 `Unexpected token '?'`，说明 Hono 子模块或 `_db` 没有用新版脚本转译；确认 sync 日志包含：

```text
[miaoda-build-hono] wrote ... route/lib/_db .js files
```

若页面有数据但 Network 没有 `/api/*`，说明妙搭自动迁移仍是 Mock，重新运行 `node source_package/scripts/miaoda-sync-to-server.js` 并做反 Mock 校验。

### 403 csrf

前端须用 `apiFetch()`（`base-path.ts` 自动带 `x-suda-csrf-token`）。

---

## pre-commit / ESLint（妙搭提交代码）

导入后或提交前执行（sync 会自动调用）：

```bash
node source_package/scripts/miaoda-patch-precommit.cjs
npm run eslint
npm run precommit
```

修复三项：

| 问题 | 处理 |
|------|------|
| `app.tsx` / `App.tsx` 大小写冲突 | 删除 `App.tsx`，保留平台入口 `app.tsx` |
| ESLint 扫 `server/hono-app` | `eslint.config.js` ignores + `!server/hono-app/**` |
| stylelint 无 CSS 文件 | `--allow-empty-input` 或创建 `scm-styles.css` |

### 手工修复（无 patch 脚本时）

```bash
rm -f client/src/App.tsx
grep -n 'server/hono-app\|injectable-should-be-provided' eslint.config.js
npm pkg set scripts.stylelint="stylelint \"client/src/**/*.css\" --allow-empty-input --quiet"
test -f client/src/index.css || printf '/* scm */\n' > client/src/scm-styles.css
```

### eslint.config.js 要点

**① 第 5 行 `ignores`** 增加 `server/hono-app`、`source_package`：

```javascript
{ ignores: ['dist', 'dist-server', 'node_modules', 'client/src/api/gen', 'server/hono-app', 'source_package', 'packages', '**/*.d.ts', '**/*.js.map'] },
```

**② `server` 配置块** 关闭规则（规则初始化时会扫 hono-app，与 ignores 无关）：

```javascript
rules: {
  '@darraghor/nestjs-typed/injectable-should-be-provided': 'off',
},
```

完整文件可复制 `source_package/miaoda/eslint.config.snippet.txt` 底部参考实现。

验证：

```bash
npm run eslint
npm run precommit
```

`tsconfig.node.json` 须 **exclude `server/hono-app`**（nest 不编 hono-app）。

详细清单：`docs/miaoda-import-checklist.md`。
