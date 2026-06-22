import { eq } from 'drizzle-orm';
import 'dotenv/config';
import { db } from './client';
import { roles, menus, roleMenus, users } from './schema/auth';
import { seedFobFeeRules } from './seed-fob-rules';

const ROLE_SEEDS = [
  { code: 'super_admin', name: '超级管理员', description: '管理角色/菜单/用户', isSystem: true },
  { code: 'pmc_planner', name: 'PMC 计划员', description: '管理 PMC 计划', isSystem: true },
  { code: 'warehouse', name: '仓库员', description: '录入库存/出入库', isSystem: true },
  { code: 'purchaser', name: '采购员', description: '管理采购/补货', isSystem: true },
  { code: 'viewer', name: '只读查看', description: '只读访问', isSystem: true },
];

type MenuSeed = {
  code: string;
  name: string;
  icon?: string;
  path?: string;
  sortOrder: number;
  isLeaf: boolean;
  children?: MenuSeed[];
};

const MENU_SEEDS: MenuSeed[] = [
  {
    code: 'dashboard',
    name: '经营看板',
    icon: 'LayoutDashboard',
    path: '/dashboard',
    sortOrder: 0,
    isLeaf: true,
  },
  {
    code: 'inventory',
    name: '库存管理',
    icon: 'Package',
    sortOrder: 1,
    isLeaf: false,
    children: [
      { code: 'inventory.overview', name: '库存总览', path: '/inventory/overview', sortOrder: 1, isLeaf: true },
      { code: 'inventory.safety', name: '安全库存设置', path: '/inventory/safety', sortOrder: 2, isLeaf: true },
      { code: 'inventory.alert', name: '缺货预警', path: '/inventory/alerts', sortOrder: 3, isLeaf: true },
    ],
  },
  {
    code: 'pmc',
    name: '下单计划',
    icon: 'ClipboardList',
    sortOrder: 2,
    isLeaf: false,
    children: [
      { code: 'pmc.suggestion', name: '补货建议', path: '/pmc/suggestions', sortOrder: 1, isLeaf: true },
      { code: 'pmc.list', name: '计划列表', path: '/pmc/list', sortOrder: 2, isLeaf: true },
      { code: 'pmc.tracking', name: '采购跟单', path: '/pmc/tracking', sortOrder: 3, isLeaf: true },
    ],
  },
  {
    code: 'compliance',
    name: '合规管理',
    icon: 'Shield',
    sortOrder: 3,
    isLeaf: false,
    children: [
      { code: 'compliance.overview', name: '合规总览', path: '/compliance/overview', sortOrder: 1, isLeaf: true },
      { code: 'compliance.skus', name: 'SKU 合规', path: '/compliance/skus', sortOrder: 2, isLeaf: true },
    ],
  },
  {
    code: 'logistics',
    name: '物流管理',
    icon: 'Truck',
    sortOrder: 4,
    isLeaf: false,
    children: [
      {
        code: 'logistics.fob_settlement',
        name: 'FOB分账',
        path: '/logistics/fob-settlement',
        sortOrder: 1,
        isLeaf: true,
      },
    ],
  },
  {
    code: 'ai',
    name: 'AI 知识库',
    icon: 'Bot',
    sortOrder: 5,
    isLeaf: false,
    children: [
      { code: 'ai.chat', name: '知识问答', path: '/ai/chat', sortOrder: 1, isLeaf: true },
    ],
  },
  {
    code: 'data',
    name: '数据中心',
    icon: 'ClipboardList',
    sortOrder: 6,
    isLeaf: false,
    children: [
      { code: 'data.products', name: '商品主数据', path: '/data/products', sortOrder: 1, isLeaf: true },
      { code: 'data.import', name: '数据导入', path: '/data/import', sortOrder: 2, isLeaf: true },
      { code: 'data.sales', name: '销量历史', path: '/data/sales', sortOrder: 3, isLeaf: true },
    ],
  },
  {
    code: 'help',
    name: '帮助中心',
    icon: 'HelpCircle',
    path: '/help',
    sortOrder: 98,
    isLeaf: true,
  },
  {
    code: 'system',
    name: '系统设置',
    icon: 'Settings',
    sortOrder: 99,
    isLeaf: false,
    children: [
      { code: 'system.users', name: '用户管理', path: '/system/users', sortOrder: 1, isLeaf: true },
      { code: 'system.roles', name: '角色与菜单', path: '/system/roles', sortOrder: 2, isLeaf: true },
    ],
  },
];

/** 已合并到其他菜单的废弃项，seed 时清理 */
const DEPRECATED_MENU_CODES = [
  'pmc.import',
  'pmc.drafts',
  'reorder',
  'reorder.suggestion',
  'reorder.forecast',
  'reorder.drafts',
  'system.menus',
  'logistics.fob_fee_rules',
];

const ROLE_MENU_CODES: Record<string, string[]> = {
  super_admin: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'inventory.alert', 'pmc', 'pmc.suggestion', 'pmc.list', 'pmc.tracking', 'compliance', 'compliance.overview', 'compliance.skus', 'logistics', 'logistics.fob_settlement', 'data', 'data.products', 'data.import', 'data.sales', 'ai', 'ai.chat', 'help', 'system', 'system.users', 'system.roles'],
  pmc_planner: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'pmc', 'pmc.suggestion', 'pmc.list', 'compliance', 'compliance.overview', 'compliance.skus', 'logistics', 'logistics.fob_settlement', 'data', 'data.products', 'data.import', 'data.sales', 'ai', 'ai.chat', 'help'],
  warehouse: ['dashboard', 'inventory', 'inventory.overview', 'inventory.alert', 'pmc', 'pmc.list', 'compliance', 'compliance.overview', 'compliance.skus', 'logistics', 'logistics.fob_settlement', 'data', 'data.products', 'data.import', 'data.sales', 'ai', 'ai.chat', 'help'],
  purchaser: ['dashboard', 'inventory', 'inventory.overview', 'inventory.safety', 'inventory.alert', 'pmc', 'pmc.list', 'pmc.tracking', 'compliance', 'compliance.overview', 'compliance.skus', 'logistics', 'logistics.fob_settlement', 'data', 'data.products', 'data.import', 'data.sales', 'ai', 'ai.chat', 'help'],
  viewer: ['dashboard', 'inventory', 'inventory.overview', 'pmc', 'pmc.suggestion', 'pmc.list', 'pmc.tracking', 'compliance', 'compliance.overview', 'compliance.skus', 'logistics', 'logistics.fob_settlement', 'data', 'data.sales', 'ai', 'ai.chat', 'help'],
};

async function removeMenuTreeByCode(code: string) {
  const [menu] = await db.select({ id: menus.id }).from(menus).where(eq(menus.code, code)).limit(1);
  if (!menu) return;

  const children = await db
    .select({ id: menus.id, code: menus.code })
    .from(menus)
    .where(eq(menus.parentId, menu.id));

  for (const child of children) {
    await removeMenuTreeByCode(child.code);
  }

  await db.delete(roleMenus).where(eq(roleMenus.menuId, menu.id));
  await db.delete(menus).where(eq(menus.id, menu.id));
  console.log(`Removed deprecated menu: ${code}`);
}

async function removeDeprecatedMenus() {
  // 先删子菜单再删父菜单（按路径深度倒序，避免 parent_id 外键冲突）
  const sorted = [...DEPRECATED_MENU_CODES].sort(
    (a, b) => b.split('.').length - a.split('.').length,
  );
  for (const code of sorted) {
    await removeMenuTreeByCode(code);
  }
}

async function seedMenus(items: MenuSeed[], parentId?: string): Promise<Map<string, string>> {
  const codeToId = new Map<string, string>();

  for (const item of items) {
    const [menu] = await db
      .insert(menus)
      .values({
        code: item.code,
        name: item.name,
        icon: item.icon,
        path: item.path,
        parentId,
        sortOrder: item.sortOrder,
        isLeaf: item.isLeaf,
      })
      .onConflictDoNothing({ target: menus.code })
      .returning({ id: menus.id });

    const menuId =
      menu?.id ??
      (await db.select({ id: menus.id }).from(menus).where(eq(menus.code, item.code)).limit(1))[0]?.id;

    if (!menuId) continue;
    codeToId.set(item.code, menuId);

    if (item.children?.length) {
      const childMap = await seedMenus(item.children, menuId);
      childMap.forEach((id, code) => codeToId.set(code, id));
    }
  }

  return codeToId;
}

async function main() {
  console.log('Seeding roles...');
  const roleIdByCode = new Map<string, string>();

  for (const role of ROLE_SEEDS) {
    const [row] = await db
      .insert(roles)
      .values(role)
      .onConflictDoNothing({ target: roles.code })
      .returning({ id: roles.id });

    const roleId =
      row?.id ??
      (await db.select({ id: roles.id }).from(roles).where(eq(roles.code, role.code)).limit(1))[0]?.id;

    if (roleId) roleIdByCode.set(role.code, roleId);
  }

  console.log('Cleaning deprecated menus...');
  await removeDeprecatedMenus();

  console.log('Seeding menus...');
  const menuIdByCode = await seedMenus(MENU_SEEDS);

  console.log('Seeding role menus...');
  for (const [roleCode, menuCodes] of Object.entries(ROLE_MENU_CODES)) {
    const roleId = roleIdByCode.get(roleCode);
    if (!roleId) continue;

    for (const menuCode of menuCodes) {
      const menuId = menuIdByCode.get(menuCode);
      if (!menuId) continue;

      await db
        .insert(roleMenus)
        .values({ roleId, menuId })
        .onConflictDoNothing({ target: [roleMenus.roleId, roleMenus.menuId] });
    }
  }

  const adminRoleId = roleIdByCode.get('super_admin');
  if (adminRoleId) {
    const existing = await db.select().from(users).where(eq(users.email, 'admin@scm.local')).limit(1);
    if (!existing.length) {
      await db.insert(users).values({
        name: '系统管理员',
        email: 'admin@scm.local',
        roleId: adminRoleId,
        isActive: true,
      });
      console.log('Created default admin user: admin@scm.local');
    }
  }

  console.log('Seeding FOB fee allocation rules...');
  await seedFobFeeRules();

  console.log('Seed completed.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
