# 角色权限与自定义菜单 PRD

## 1. 需求分析

### 背景
系统支持多角色使用，不同角色关注不同功能模块。
菜单需支持角色自定义：管理员可为每个角色独立配置可见菜单。

### 用户角色（预设）

| 角色 | 说明 |
|------|------|
| `super_admin` | 超级管理员，管理角色/菜单/用户，不可删除 |
| `pmc_planner` | PMC 计划员，管理 PMC 计划 |
| `warehouse` | 仓库员，录入库存/出入库 |
| `purchaser` | 采购员，管理采购/补货 |
| `viewer` | 只读查看 |

> 角色名称和权限均可由管理员调整，以上为初始预设。

---

## 2. 数据模型

### 表：menus（菜单目录）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | 主键 |
| name | varchar(100) | ✅ | 菜单名称 |
| code | varchar(100) | ✅ | 唯一编码，如 `inventory.list` |
| icon | varchar(100) | | 图标名 |
| path | varchar(200) | | 前端路由 |
| parent_id | uuid | | 父菜单 id（null = 顶级） |
| sort_order | int | ✅ | 排序 |
| is_leaf | boolean | ✅ | 是否叶子节点（页面级） |
| created_at | timestamptz | ✅ | |

**菜单树示例**（与 `packages/db/src/seed.ts` 一致）：
```
📊 经营看板 (dashboard)
📦 库存管理 (inventory)
  ├── 库存总览 (inventory.overview)
  ├── 安全库存设置 (inventory.safety)
  └── 缺货预警 (inventory.alert)
📋 下单计划 (pmc)
  ├── 补货建议 (pmc.suggestion)
  ├── 计划列表 (pmc.list)
  └── 采购跟单 (pmc.tracking)
🛡️ 合规管理 (compliance)
  ├── 合规总览 (compliance.overview)
  └── SKU 合规 (compliance.skus)
📁 数据中心 (data)
  ├── 商品主数据 (data.products)
  ├── 数据导入 (data.import)
  └── 销量历史 (data.sales)
🤖 AI 知识库 (ai)
  └── 知识问答 (ai.chat)
⚙️ 系统设置 (system) [仅 super_admin]
  ├── 用户管理 (system.users)
  ├── 角色管理 (system.roles)
  └── 菜单配置 (system.menus)
```

---

### 表：roles（角色）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | 主键 |
| name | varchar(100) | ✅ | 角色名称 |
| code | varchar(100) | ✅ ✦唯一 | 英文标识 |
| description | text | | 描述 |
| is_system | boolean | ✅ | 系统预设角色，不可删除 |
| created_at | timestamptz | ✅ | |

---

### 表：role_menus（角色菜单关联）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | 主键 |
| role_id | uuid | ✅ | FK → roles.id |
| menu_id | uuid | ✅ | FK → menus.id |
| created_at | timestamptz | ✅ | |

**索引**：`(role_id, menu_id)` UNIQUE

---

### 表：users（用户）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | uuid | ✅ | 主键 |
| feishu_user_id | varchar(100) | | 飞书 open_id（未来对接） |
| name | varchar(100) | ✅ | 姓名 |
| email | varchar(200) | ✅ ✦唯一 | 登录邮箱 |
| role_id | uuid | ✅ | FK → roles.id |
| is_active | boolean | ✅ | 是否启用 |
| created_at | timestamptz | ✅ | |

---

## 3. 页面流程

### 3.1 菜单配置（系统设置 > 菜单配置）

```
[菜单树列表] → 点击角色 → [角色菜单配置]
  - 左：全量菜单树（Checkbox）
  - 右：当前角色已选菜单预览
  - 操作：保存
```

### 3.2 登录后菜单加载

```
前端启动 → GET /api/me → 返回用户+角色信息
→ GET /api/me/menus → 返回该角色的菜单树（已过滤）
→ 渲染侧边栏
```

---

## 4. API 设计

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/me` | 当前用户信息 |
| GET | `/api/me/menus` | 当前角色菜单树 |
| GET | `/api/roles` | 角色列表 |
| POST | `/api/roles` | 创建角色 |
| PUT | `/api/roles/:id` | 更新角色 |
| DELETE | `/api/roles/:id` | 删除非系统角色 |
| GET | `/api/roles/:id/menus` | 角色已配置菜单 |
| PUT | `/api/roles/:id/menus` | 更新角色菜单 |
| GET | `/api/menus` | 全量菜单树 |

---

## 5. 业务逻辑

- `super_admin` 可见所有菜单，不受 `role_menus` 限制
- 删除角色前需检查：如有用户绑定该角色，不可删除
- 菜单父节点选中时自动选中子节点；子节点全取消时自动取消父节点
- 前端路由守卫：访问无权限路由时跳转 403 页面
