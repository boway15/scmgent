# scm-agent 蓝图汇报 · 静态站点

将 `canvases/scm-feishu-ai-blueprint.canvas.tsx` 发布为独立网页，供团队浏览。

## 本地预览

```bash
cd sites/blueprint-report
npm install
npm run dev
```

构建前会自动从 `canvases/` 同步最新 Canvas 内容。

## Vercel 部署

在 Vercel 控制台新建项目，**Root Directory** 设为 `sites/blueprint-report`，其余使用默认 Vite 检测即可。

或使用 CLI（需已登录 `vercel login`）：

```bash
cd sites/blueprint-report
npx vercel --prod
```
