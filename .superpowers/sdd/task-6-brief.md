### Task 6: 本地 Docker 发布验证

**Files:** 无代码；按开发机 Docker 流程

- [ ] **Step 1: 构建并启动**

在 `d:\Docker\project\scm-agent`：

```powershell
pnpm docker:build
pnpm docker:start
docker compose -p scm-agent ps
curl.exe -s http://localhost:8081/api/health
```

Expected: web Up；health JSON 且 db 正常。

- [ ] **Step 2: API 冒烟（需已登录 cookie 或用浏览器 DevTools）**

浏览器打开 `http://localhost:8081`，登录后：

1. `/data/forecast`：Network 中 `sales-forecast-versions` 应带 `page`/`pageSize`，响应为 `{ items, total, ... }`；列表有「创建人」；默认约 20 条。
2. `/data/demand-plan`：请求 **不再** `pageSize=500`；有「创建人」；翻页/筛选正常。
3. 策略 Tab、草稿详情「合并到已发布」不报错（读 `items`）。

- [ ] **Step 3: 记录结果**

在对话中回报：health、两列表首屏请求 pageSize、创建人是否可见、发现的问题。

---
