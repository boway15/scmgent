# Task 6 Report: 本地 Docker 发布验证

**Status:** DONE  
**Commits:** none

## Steps

1. `pnpm docker:build` — web/cron 镜像构建成功  
2. `pnpm docker:start` — web Recreate → Healthy  
3. `curl http://localhost:8081/api/health` — `status:ok`, `db:connected`

## API 冒烟（admin 登录 cookie）

| API | 结果 |
|-----|------|
| `GET /api/sales-forecast-versions?includeStats=1&statsScope=list&page=1&pageSize=20` | `{ items, total:34, page:1, pageSize:20 }`；items=20；`createdByName=系统管理员`；含 stats |
| `GET /api/demand-plans?page=1&pageSize=20` | `{ items, total:17, page:1, pageSize:20 }`；`createdByName=系统管理员` |

## UI 冒烟（浏览器 localhost:8081）

| 页面 | 结果 |
|------|------|
| `/data/forecast` | 表头有「创建人」；显示系统管理员；分页「共 34 条 · 第 1 / 2 页 · 每页 20 条」 |
| `/data/demand-plan` | 表头有「创建人」；显示系统管理员；默认每页 20（不再 500） |

## Concerns

- 工作区仍混有下载中心等未提交改动；本次 Docker 镜像包含整个工作区快照。
- 未单独压测「改前 vs 改后」耗时；从请求形态看首屏已从最多 50+stats / 500 条降为 pageSize=20。
