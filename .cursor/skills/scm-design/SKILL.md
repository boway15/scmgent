---
name: scm-design
description: >-
  跨境电商供应链平台 UI 设计规范（淘宝活力橙主题）。含色彩、排版、布局、组件与 AI 交互原则。
  Use when building or styling frontend pages, shadcn/ui components, Tailwind tokens,
  or implementing AI-enhanced form/PDF preview interactions.
---

# SCM 设计规范

前端实现须对齐本规范；设计 Token 已落地于 `apps/web/src/index.css` 与 `tailwind.config.js`。

## 1. 核心色彩看板 (Color Palette)

| 角色 | 色值 (Hex) | 应用场景 |
|------|------------|----------|
| 品牌主色 (Primary) | `#FF5000` | 淘宝活力橙。主按钮、导航选中态、核心数字高亮 |
| 辅助悬浮 (Hover) | `#FF7A22` | 主按钮 Hover 状态 |
| 核心文字 (Text-Main) | `#1F1F1F` | 大标题、重点数据 |
| 次要文字 (Text-Sub) | `#595959` | 标签名、说明文字、副标题 |
| 辅助文字 (Text-Hint) | `#8C8C8C` | 占位符、失效状态 |
| 卡片背景 (Bg-Card) | `#FFFFFF` | 功能模块、表格容器 |
| 全局背景 (Bg-Layout) | `#F5F7FA` | 衬托纯白卡片的浅灰底色 |
| AI 填充 (Ai-Fill) | `#F5F3FF` | AI 自动填充输入框背景 |
| 联动高亮 (Highlight-Warm) | `#FFEDD5` | 表单项 ↔ PDF 预览联动闪烁 |

Tailwind 类名映射：`primary` / `primary-hover` / `text-main` / `text-sub` / `text-hint` / `bg-card` / `bg-layout` / `ai-fill` / `highlight-warm`。

## 2. 布局与空间 (Layout & Spacing)

- **卡片式承载**：全局背景 `#F5F7FA`，功能模块用 `<Card>` 纯白封装
- **弥散投影**：`box-shadow: 0 1px 3px rgba(0,0,0,0.05)` → Tailwind `shadow-card`
- **全局圆角**：统一 `6px` → `--radius: 0.375rem`，`rounded-md`
- **响应式**：12 列栅格；双栏预览 `grid-cols-2` 或 `md:grid-cols-2` 采用 50:50

## 3. 字体规范 (Typography)

| 层级 | 规格 | 用途 |
|------|------|------|
| Page Title | 24px / Bold / `#1F1F1F` | 页面级标题，用 `<PageHeader>` |
| Module Title | 16px / Semi-Bold / `#1F1F1F` | 卡片标题，用 `<CardTitle>` |
| Body Text | 14px / Regular / `#1F1F1F` | 正文 |
| Label Text | 14px / Regular / `#595959` | 表单标签、表头 |

字体族：
- 数字：`Inter`, `Roboto Mono`, monospace
- 中文：`PingFang SC`, `Microsoft YaHei`, system-ui

## 4. 组件原则 (Component Logic)

- **主操作**：每个页面/卡片区域仅 **一个** Solid 活力橙按钮（`variant="default"`）
- **次要操作**：白底灰边幽灵按钮（`variant="outline"`）或 `variant="ghost"`
- **AI 输入**：`variant="ai"` 的 `<Input>` / `<AiInput>`，背景 `#F5F3FF`，右侧 ✨ 标识

## 5. AI 增强交互 (AI UX)

| 模式 | 实现 |
|------|------|
| 异常拦截 | `<AiBanner>`：左侧琥珀橙警告图标，右侧紫橙渐变「一键修复」按钮 |
| 流光进度条 | `<AiProgressBar>`：`linear-gradient(135deg, #A855F7, #FF5000)` 流光动画 |
| 联动高亮 | 点击左侧表单项，右侧预览区对应块闪烁 `#FFEDD5`（`.highlight-pulse`） |

## 6. 开发检查清单

- [ ] 页面背景为 `bg-layout`，内容区为 `Card` + `shadow-card`
- [ ] 每页仅一个 Solid 主按钮
- [ ] 标题层级：PageHeader 24px → CardTitle 16px
- [ ] 数字列使用 `font-mono` 或 `font-numeric`
- [ ] AI 相关字段使用 `ai-fill` 样式
- [ ] 错误/异常使用 `AiBanner`，AI 加载使用 `AiProgressBar`

## 组件路径

```
apps/web/src/components/
├── PageHeader.tsx
├── AiBanner.tsx
├── AiProgressBar.tsx
├── AiInput.tsx
└── ui/  (button, card, input — 已对齐 Token)
```
