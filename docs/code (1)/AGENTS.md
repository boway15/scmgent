# zip包项目原地迁移任务

## 任务描述

将用户上传的zip包迁移到妙搭平台。支持 **React 项目** 和 **HTML 项目**。迁移范围仅包括前端代码。

**注意**: 直接开始执行迁移任务，不需要再向用户澄清是否需要迁移或者检查迁移状态。迁移范围只包括前端代码，排除服务端代码。

## 执行流程

### Step 1: 识别项目类型
检查 `source_package/package.json` 是否存在及是否包含 `react` 依赖，确定项目类型。

### Step 2: 执行迁移任务

**若为 React 项目**：
1. 主题配置迁移（参考 [通用任务 1](#1-主题配置迁移)）
2. R2: 修正导入路径 `../` → `@/`
3. R5: 移除 Supabase/服务端依赖
4. 图片资源引用修正（参考 [通用任务 2](#2-图片资源引用修正)）
5. R3: JSX 转 TSX（可选）
6. R4: 环境变量适配
7. R1: 创建页面入口 `pages/Home/Home.tsx`
8. 路由配置（参考 [通用任务 3](#3-路由配置)）

**若为 HTML 项目**：
1. **H0: 外部依赖扫描 + CDN → npm 转换**（**关键前置 — 转 React 前必跑**，参考 [H0 段](#h0-外部依赖扫描--cdn--npm-转换)）
2. H1: 分析 HTML 结构
3. 主题配置迁移（参考 [通用任务 1](#1-主题配置迁移)）
4. H2: 转换为 React 组件
5. H3: CSS 迁移（保留或转 Tailwind）
6. H4: JS 逻辑转换为 React State
7. 图片资源引用修正（参考 [通用任务 2](#2-图片资源引用修正)）
8. H5: 创建页面并配置路由（参考 [通用任务 3](#3-路由配置)）
9. H6: 第三方库处理（H0 已处理 CDN 库，此处仅补充非 CDN 引入的库）

### Step 3: 构建验证
运行 `npm run build`，根据错误信息参考 [常见错误修复](#常见错误修复) 进行修复。

## 项目类型识别

| 检测条件 | 项目类型 | 迁移路径 |
|----------|----------|----------|
| `source_package/package.json` 含 `react` 依赖 | React | [React 迁移任务](#react-迁移任务) |
| 存在 `source_package/*.html` 且无 React | HTML | [HTML 迁移任务](#html-迁移任务) |

## 环境差异

| 项目 | React 项目 (源→目标) | HTML 项目 (源→目标) |
|------|---------------------|---------------------|
| 框架 | React 18→19 | 原生 HTML→React 19 |
| 样式 | Tailwind 3→4 | CSS/内联→Tailwind 4 |
| 构建 | Vite 5→Rspack | 无→Rspack |
| 模块 | - | `<script>`→ES Modules |

## 文件结构映射

### React 项目

| zip包源路径 | 合并后位置 | 说明 |
|-------------|------------|------|
| `src/components/**` (非 ui) | `client/src/components/**` | 直接可用 |
| `src/components/ui/**` | `source_package/...` | 与脚手架冲突，智能排除 |
| `src/pages/**`, `src/hooks/**`, `src/lib/**`, `src/types/**`, `src/contexts/**` | `client/src/...` | 直接可用 |
| `src/db/**`, `src/services/**`, `src/integrations/**` | `source_package/...` | **不迁移** |
| `src/App.(tsx|jsx)` | `source_package/...` | 参考其结构创建页面 |
| `src/index.css` | `source_package/...` | 需提取主题 |
| `public/**`, `src/assets/**` | `client/public/**`, `client/src/assets/**` | 静态资源 |

### HTML 项目

| zip包源路径 | 合并后位置 | 说明 |
|-------------|------------|------|
| `*.html` | `source_package/` | 转换为 React 组件 |
| `css/**`, `js/**` | `source_package/` | 参考转换 |
| `images/**`, `assets/**`, `fonts/**` | `client/public/...` | 直接可用 |

## 通用迁移任务

### 1. 主题配置迁移

读取源项目 CSS 变量（React: `source_package/src/index.css`，HTML: `source_package/css/*.css`），融合到 `client/src/tailwind-theme.css`。

**HSL 语法转换**（Tailwind 3→4）：

```css
/* 源 */
:root { --primary: 210 100% 50%; }      /* Tailwind 3 裸值 */

/* 目标 */
:root { --primary: hsl(210 100% 50%); } /* 必须包裹 hsl() */

@theme inline {
  --color-primary: var(--primary);
}
```

同名变量直接覆盖，色彩值要求转换为 HSL 格式

### 2. 图片资源引用修正

```tsx
const BASE_PATH = process.env.CLIENT_BASE_PATH || '';

// public/ 目录图片 - 必须拼接 BASE_PATH
<img src={`${BASE_PATH}/images/logo.png`} />
<div style={{ backgroundImage: `url('${BASE_PATH}/images/bg.jpg')` }} />

// src/assets/ 目录图片 - 使用 import（自动处理路径）
import heroImage from '@/assets/hero.png';
<img src={heroImage} />
```

### 3. 路由配置

修改 `client/src/app.tsx`：

```tsx
import Home from './pages/Home/Home';

const RoutesComponent = () => (
  <Routes>
    <Route element={<Layout />}>
      <Route index element={<Home />} />
      {/* 其他路由 */}
    </Route>
    <Route path="*" element={<NotFound />} />
  </Routes>
);
```

## React 迁移任务

### R1. 创建页面入口

参考 `source_package/src/App.tsx` 创建 `client/src/pages/Home/Home.tsx`：

```tsx
import { HeroSection } from '@/components/HeroSection';
import { Features } from '@/components/Features';

const Home = () => (
  <>
    <HeroSection />
    <Features />
  </>
);

export default Home;
```

### R2. 导入路径修正

```tsx
// 源                                    // 目标
import { Button } from '../components/ui/button';  →  import { Button } from '@/components/ui/button';
import { cn } from '../lib/utils';                 →  import { cn } from '@/lib/utils';
```

`@/` 指向 `client/src/`

### R3. JSX 转 TSX（可选）

```tsx
// 添加 Props 接口
interface Props { name: string; value: string; }
export function Card({ name, value }: Props) { ... }

// 常用类型
const handleSubmit = (e: React.FormEvent) => { ... }
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => { ... }
const [items, setItems] = useState<Item[]>([]);
const cardRef = useRef<HTMLDivElement>(null);
```

### R4. 环境变量适配

```tsx
import.meta.env.VITE_API_URL  →  process.env.VITE_API_URL
```

### R5. 移除后端依赖

妙搭不支持 Supabase 和服务端逻辑，需从业务组件中移除：

```tsx
// ❌ 删除
import { supabase } from '@/db/supabase';
import { userService } from '@/services/userService';
const { data } = await supabase.from('items').select('*');

// ✅ 替换为静态数据
const items = [{ id: 1, name: '示例数据' }];
const userData = { name: '演示用户', email: 'demo@example.com' };
```

### R6. Hooks 冲突处理

脚手架已有的 Hooks（如 `use-mobile.ts`）会自动排除。确保组件导入 `@/hooks/xxx`。

## HTML 迁移任务

### H0. 外部依赖扫描 + CDN → npm 转换（关键前置）

**必须 H2/H3/H4 之前做**：CDN `<script src=...>` 引入的全局变量（`am5` / `d3` / `gsap` 等）在 React 组件里不存在，先转 React 会写出 `declare const xxx: any` 兜底——错误用法。先把 CDN 换 npm，下游 React 代码才正确。

#### Step 1: 扫描

```bash
grep -n -E 'src="https?://[^"]+\.(js|css)"' source_package/*.html
```

把所有匹配项列出来，逐条按下表归类。

#### Step 2: 按规则归类（**按规则，不是查下方示例表**）

| 来源 | 处理 |
|------|------|
| 脚手架 `package.json` 已有 | 改 ES `import`，删 CDN `<script>` |
| 有官方 npm 包 | `npm install --save <pkg>`，改 `import`，删 CDN；**禁止保留 CDN script** |
| 无 npm 等价（极少见） | 保持原状不处理 |
| Tailwind/Bootstrap 等 framework CSS | 删 CDN，token 走 [主题配置迁移](#1-主题配置迁移) |

**示例（非穷举，按上表规则归类；多数库 npm 包名 = 库名）**：

| CDN 库 | npm 处理 |
|---|---|
| ECharts | 用脚手架已有 `echarts` + `echarts-for-react`（不要重装） |
| Chart.js | 优先迁到 `echarts`；不可迁再装 `chart.js` |
| amCharts 5 | `@amcharts/amcharts5` + 数据包 `@amcharts/amcharts5-geodata` |
| Three.js | `three` + React 集成 `@react-three/fiber` |

#### Step 3: 验证 checklist（H0 完成时必查）

- [ ] Step 1 grep 输出的所有库都已处理
- [ ] **`client/index.html` 中 0 个 `<script src="https://...">`**（准出门——CSP 阻断 CDN 致预览白屏）
- [ ] `package.json` 已加 npm 依赖（`--save`，不是 dev）
- [ ] **禁止 `declare const am5: any` 类全局变量声明文件**（CDN 时代兜底，npm 包自带类型）

完成 H0 后再进 H2 把组件转 React。

### H1. HTML 结构分析

分析 `source_package/*.html`，识别页面结构（header/main/footer）和可复用组件（导航栏、卡片等）。

### H2. HTML 转 React 组件

**属性转换规则**：

| HTML | JSX |
|------|-----|
| `class` | `className` |
| `for` | `htmlFor` |
| `onclick` | `onClick` |
| `style="color: red"` | `style={{ color: 'red' }}` |
| `<img>`, `<input>`, `<br>` | 自闭合 `/>` |

**示例**：

```tsx
// client/src/components/HeroSection.tsx
const BASE_PATH = process.env.CLIENT_BASE_PATH || '';

const HeroSection = () => {
  const handleClick = () => { /* 转换原 JS 逻辑 */ };

  return (
    <section className="hero">
      <h1 className="title">Welcome</h1>
      <button className="btn" onClick={handleClick}>Get Started</button>
      <img src={`${BASE_PATH}/images/hero.png`} alt="Hero" />
    </section>
  );
};

export { HeroSection };
```

### H3. CSS 迁移策略

**策略 A - 保留原 CSS**：复制到 `client/src/styles/legacy.css` 并导入

**策略 B - 转 Tailwind**（推荐）：

| CSS | Tailwind |
|-----|----------|
| `padding: 16px` / `margin: 8px` | `p-4` / `m-2` |
| `display: flex` + `justify-content: center` | `flex justify-center` |
| `font-size: 18px` / `font-weight: bold` | `text-lg font-bold` |
| `border-radius: 8px` / `box-shadow` | `rounded-lg shadow-md` |

### H4. JavaScript 逻辑转换

**DOM 操作 → React State**：

```tsx
// 原生 JS: document.getElementById('x').classList.toggle('hidden')
// React:
const [isVisible, setIsVisible] = useState(false);
<div className={isVisible ? '' : 'hidden'}>Content</div>
```

**表单处理**：

```tsx
const [formData, setFormData] = useState({ name: '', email: '' });
const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  setFormData(prev => ({ ...prev, [e.target.name]: e.target.value }));
};
```

**定时器**：

```tsx
useEffect(() => {
  const interval = setInterval(() => setCount(c => c + 1), 1000);
  return () => clearInterval(interval);
}, []);
```

### H5. 多页面与链接转换

每个 HTML 文件创建对应 React 页面，配置路由。链接转换：

```tsx
// 内部链接
<a href="about.html">  →  <Link to="/about">

// 外部链接保持 <a>
<a href="https://external.com" target="_blank" rel="noopener noreferrer">
```

### H6. 第三方库处理
| 原库 | 处理 |
|------|------|
| jQuery | 移除，用 React 状态替代 |
| Bootstrap JS | 移除，用 React 组件替代 |
| Chart.js / Swiper | 检查脚手架是否支持，否则移除 |

## 常见错误修复

| 错误 | 原因 | 修复 |
|------|------|------|
| `Cannot find module '@/...'` | 路径错误 | 检查文件是否在 `client/src/` |
| 图片 404 | 未拼接路径 | 添加 `CLIENT_BASE_PATH` |
| `bg-primary` 无效 | HSL 格式 | 包裹 `hsl()` |
| `class`/`for` invalid | HTML 属性 | → `className`/`htmlFor` |
| `Parameter implicitly has 'any'` | 无类型 | 添加 TypeScript 注解 |
| `import.meta.env` 不存在 | 环境变量 | → `process.env` |
| JSX must have one parent | 多根元素 | 用 `<>...</>` 包裹 |
| 预览白屏 / `xxx is not defined` 全局变量 | CDN `<script>` 被预览 CSP 阻断 | 按 [H0](#h0-外部依赖扫描--cdn--npm-转换) 改 npm |

## 约束

**允许** ✅ 修改 `client/src/` 下的 `.ts` / `.tsx` / `.css`；`npm install --save` 仅限 H0 列出的 CDN 替代品
**禁止** ❌ 改 `vite.config` / `tsconfig` 等构建配置；H0/H6 之外引入新库；删 `components/ui`；`client/index.html` 保留任何 `<script src="https://...">`

## 验收标准

1. Rspack 构建成功
2. 首页路由可访问且有实际内容
3. 交互功能正常响应
4. Tailwind 样式正确