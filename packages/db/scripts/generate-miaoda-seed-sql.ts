/**
 * 生成妙搭 SQL 控制台可用的 seed（roles / menus / role_menus / admin 用户）
 * 用法: pnpm exec tsx scripts/generate-miaoda-seed-sql.ts > ../../docs/sql/miaoda-seed-roles-menus.sql
 */
import { writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

type MenuSeed = {
  code: string;
  name: string;
  icon?: string;
  path?: string;
  sortOrder: number;
  isLeaf: boolean;
  children?: MenuSeed[];
};

const ROLE_SEEDS = [
  { code: 'super_admin', name: '超级管理员', description: '管理角色/菜单/用户', isSystem: true },
  { code: 'pmc_planner', name: 'PMC 计划员', description: '管理 PMC 计划', isSystem: true },
  { code: 'warehouse', name: '仓库员', description: '录入库存/出入库', isSystem: true },
  { code: 'purchaser', name: '采购员', description: '管理采购/补货', isSystem: true },
  { code: 'viewer', name: '只读查看', description: '只读访问', isSystem: true },
];

const MENU_SEEDS: MenuSeed[] = [
  { code: 'dashboard', name: '经营看板', icon: 'LayoutDashboard', path: '/dashboard', sortOrder: 0, isLeaf: true },
  {
    code: 'inventory', name: '库存管理', icon: 'Package', sortOrder: 1, isLeaf: false,
    children: [
      { code: 'inventory.overview', name: '库存总览', path: '/inventory/overview', sortOrder: 1, isLeaf: true },
      { code: 'inventory.safety', name: '安全库存设置', path: '/inventory/safety', sortOrder: 2, isLeaf: true },
      { code: 'inventory.alert', name: '缺货预警', path: '/inventory/alerts', sortOrder: 3, isLeaf: true },
    ],
  },
  {
    code: 'pmc', name: '下单计划', icon: 'ClipboardList', sortOrder: 2, isLeaf: false,
    children: [
      { code: 'pmc.suggestion', name: '补货建议', path: '/pmc/suggestions', sortOrder: 1, isLeaf: true },
      { code: 'pmc.list', name: '计划列表', path: '/pmc/list', sortOrder: 2, isLeaf: true },
      { code: 'pmc.tracking', name: '采购跟单', path: '/pmc/tracking', sortOrder: 3, isLeaf: true },
    ],
  },
  {
    code: 'procurement', name: '采购管理', icon: 'ShoppingCart', sortOrder: 3, isLeaf: false,
    children: [
      { code: 'procurement.bulk_stock', name: '大件备货申请', path: '/procurement/bulk-stock', sortOrder: 1, isLeaf: true },
      { code: 'procurement.follow_up', name: '采购跟单', path: '/procurement/follow-up', sortOrder: 2, isLeaf: true },
    ],
  },
  {
    code: 'cs', name: '客服管理', icon: 'Headphones', sortOrder: 4, isLeaf: false,
    children: [
      { code: 'cs.quality', name: '回复评分', path: '/cs/quality', sortOrder: 1, isLeaf: true },
    ],
  },
  {
    code: 'logistics', name: '物流管理', icon: 'Truck', sortOrder: 5, isLeaf: false,
    children: [
      { code: 'logistics.fob_settlement', name: 'FOB分账', path: '/logistics/fob-settlement', sortOrder: 1, isLeaf: true },
    ],
  },
  {
    code: 'ai', name: 'AI 知识库', icon: 'Bot', sortOrder: 6, isLeaf: false,
    children: [{ code: 'ai.chat', name: '知识问答', path: '/ai/chat', sortOrder: 1, isLeaf: true }],
  },
  {
    code: 'data', name: '数据中心', icon: 'ClipboardList', sortOrder: 7, isLeaf: false,
    children: [
      { code: 'data.products', name: '商品主数据', path: '/data/products', sortOrder: 1, isLeaf: true },
      { code: 'data.sales', name: '销量历史', path: '/data/sales', sortOrder: 2, isLeaf: true },
      { code: 'data.forecast', name: '销售预测', path: '/data/forecast', sortOrder: 3, isLeaf: true },
    ],
  },
  {
    code: 'intel', name: '跨境资讯', icon: 'Newspaper', sortOrder: 8, isLeaf: false,
    children: [
      { code: 'intel.news', name: '资讯采集', path: '/intel/news', sortOrder: 1, isLeaf: true },
    ],
  },
  { code: 'help', name: '帮助中心', icon: 'HelpCircle', path: '/help', sortOrder: 98, isLeaf: true },
  {
    code: 'system', name: '系统设置', icon: 'Settings', sortOrder: 99, isLeaf: false,
    children: [
      { code: 'system.users', name: '用户管理', path: '/system/users', sortOrder: 1, isLeaf: true },
      { code: 'system.roles', name: '角色与菜单', path: '/system/roles', sortOrder: 2, isLeaf: true },
    ],
  },
];

const ROLE_MENU_CODES: Record<string, string[]> = {
  super_admin: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'inventory.alert', 'pmc', 'pmc.suggestion', 'pmc.list', 'pmc.tracking', 'procurement', 'procurement.bulk_stock', 'procurement.follow_up', 'cs', 'cs.quality', 'logistics', 'logistics.fob_settlement', 'data', 'data.products', 'data.sales', 'data.forecast', 'intel', 'intel.news', 'ai', 'ai.chat', 'help', 'system', 'system.users', 'system.roles'],
  pmc_planner: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'pmc', 'pmc.suggestion', 'pmc.list', 'procurement', 'procurement.bulk_stock', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.products', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
  warehouse: ['dashboard', 'inventory', 'inventory.overview', 'inventory.alert', 'pmc', 'pmc.list', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.products', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
  purchaser: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'inventory.alert', 'pmc', 'pmc.list', 'pmc.tracking', 'procurement', 'procurement.bulk_stock', 'procurement.follow_up', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.products', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
  viewer: ['dashboard', 'inventory', 'inventory.overview', 'pmc', 'pmc.suggestion', 'pmc.list', 'pmc.tracking', 'procurement', 'procurement.bulk_stock', 'procurement.follow_up', 'logistics', 'logistics.fob_settlement', 'cs', 'cs.quality', 'data', 'data.sales', 'data.forecast', 'ai', 'ai.chat', 'help'],
};

function sqlStr(v: string | null | undefined): string {
  if (v == null) return 'NULL';
  return `'${v.replace(/'/g, "''")}'`;
}

function flattenMenus(items: MenuSeed[], parentCode?: string): Array<MenuSeed & { parentCode?: string }> {
  const out: Array<MenuSeed & { parentCode?: string }> = [];
  for (const item of items) {
    out.push({ ...item, parentCode });
    if (item.children?.length) out.push(...flattenMenus(item.children, item.code));
  }
  return out;
}

const lines: string[] = [
  '-- Miaoda seed: roles, menus, role_menus, default admin',
  '-- Prerequisite: drizzle migrations 0000-0012',
  '-- Idempotent: safe to re-run (uses WHERE NOT EXISTS, no UNIQUE constraint required)',
  '',
];

for (const role of ROLE_SEEDS) {
  lines.push(
    `INSERT INTO roles (name, code, description, is_system) SELECT ${sqlStr(role.name)}, ${sqlStr(role.code)}, ${sqlStr(role.description)}, ${role.isSystem} WHERE NOT EXISTS (SELECT 1 FROM roles WHERE code = ${sqlStr(role.code)});`,
  );
}

lines.push('');

const flatMenus = flattenMenus(MENU_SEEDS);
for (const menu of flatMenus) {
  const parentSql = menu.parentCode
    ? `(SELECT id FROM menus WHERE code = ${sqlStr(menu.parentCode)} LIMIT 1)`
    : 'NULL';
  lines.push(
    `INSERT INTO menus (name, code, icon, path, parent_id, sort_order, is_leaf) SELECT ${sqlStr(menu.name)}, ${sqlStr(menu.code)}, ${sqlStr(menu.icon ?? null)}, ${sqlStr(menu.path ?? null)}, ${parentSql}, ${menu.sortOrder}, ${menu.isLeaf} WHERE NOT EXISTS (SELECT 1 FROM menus WHERE code = ${sqlStr(menu.code)});`,
  );
}

lines.push('');

for (const [roleCode, menuCodes] of Object.entries(ROLE_MENU_CODES)) {
  for (const menuCode of menuCodes) {
    lines.push(
      `INSERT INTO role_menus (role_id, menu_id) SELECT r.id, m.id FROM roles r, menus m WHERE r.code = ${sqlStr(roleCode)} AND m.code = ${sqlStr(menuCode)} AND NOT EXISTS (SELECT 1 FROM role_menus rm WHERE rm.role_id = r.id AND rm.menu_id = m.id);`,
    );
  }
}

lines.push('');
lines.push(
  `INSERT INTO users (name, email, role_id, is_active) SELECT '系统管理员', 'admin@scm.local', r.id, true FROM roles r WHERE r.code = 'super_admin' AND NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@scm.local');`,
);
lines.push('');

const outPath = join(__dirname, '../../../docs/sql/miaoda-seed-roles-menus.sql');
writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`Wrote ${outPath} (${lines.length} lines)`);
