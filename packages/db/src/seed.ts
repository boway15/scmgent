import { eq } from 'drizzle-orm';
import 'dotenv/config';
import { db } from './client';
import { roles, menus, roleMenus, users } from './schema/auth';
import { hashPassword } from './password';
import { seedFobFeeRules } from './seed-fob-rules';
import { seedFobServiceProviders } from './seed-fob-service-providers';

const ROLE_SEEDS = [
  { code: 'super_admin', name: '超级管理员', description: '管理角色/菜单/用户', isSystem: true },
  { code: 'pending', name: '待分配', description: '注册或首次飞书登录默认角色，无菜单权限', isSystem: true },
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
    name: '库存运营',
    icon: 'Package',
    sortOrder: 10,
    isLeaf: false,
    children: [
      {
        code: 'inventory.planning_dashboard',
        name: '规划驾驶舱',
        path: '/inventory/planning-dashboard',
        sortOrder: 10,
        isLeaf: true,
      },
      { code: 'inventory.alert', name: '库存概览', path: '/inventory/alerts', sortOrder: 20, isLeaf: true },
      { code: 'inventory.overview', name: '库存周转', path: '/inventory/overview', sortOrder: 30, isLeaf: true },
      { code: 'inventory.planning', name: 'SKU 库存规划', path: '/inventory/planning', sortOrder: 40, isLeaf: true },
      { code: 'inventory.pools', name: '库存三池', path: '/inventory/pools', sortOrder: 50, isLeaf: true },
      { code: 'inventory.query', name: '库存查询', path: '/inventory/query', sortOrder: 60, isLeaf: true },
      {
        code: 'inventory.procurement_ops',
        name: '全链库存',
        path: '/inventory/procurement-ops',
        sortOrder: 65,
        isLeaf: true,
      },
      {
        code: 'inventory.data_issues',
        name: '数据问题',
        path: '/inventory/data-issues',
        sortOrder: 70,
        isLeaf: true,
      },
      {
        code: 'inventory.unallocated',
        name: '未定仓供应',
        path: '/inventory/unallocated',
        sortOrder: 80,
        isLeaf: true,
      },
      { code: 'inventory.safety', name: '安全库存设置', path: '/inventory/safety', sortOrder: 90, isLeaf: true },
      { code: 'inventory.lead_time', name: '交期配置', path: '/inventory/lead-time', sortOrder: 100, isLeaf: true },
    ],
  },
  {
    code: 'supply',
    name: '采购发运',
    icon: 'Truck',
    sortOrder: 20,
    isLeaf: false,
    children: [
      { code: 'pmc.suggestion', name: '补货建议', path: '/pmc/suggestions', sortOrder: 10, isLeaf: true },
      { code: 'pmc.list', name: '计划列表', path: '/pmc/list', sortOrder: 20, isLeaf: true },
      { code: 'pmc.tracking', name: '计划跟单', path: '/pmc/tracking', sortOrder: 30, isLeaf: true },
      { code: 'pmc.shipments', name: '发运管理', path: '/pmc/shipments', sortOrder: 40, isLeaf: true },
      {
        code: 'procurement.bulk_stock',
        name: '大件备货申请',
        path: '/procurement/bulk-stock',
        sortOrder: 50,
        isLeaf: true,
      },
      {
        code: 'procurement.follow_up',
        name: '采购跟单',
        path: '/procurement/follow-up',
        sortOrder: 60,
        isLeaf: true,
      },
      {
        code: 'procurement.costing',
        name: '产品成本核算',
        path: '/procurement/costing',
        sortOrder: 70,
        isLeaf: true,
      },
      {
        code: 'logistics.fob_settlement',
        name: 'FOB 分账',
        path: '/logistics/fob-settlement',
        sortOrder: 80,
        isLeaf: true,
      },
    ],
  },
  {
    code: 'data',
    name: '数据分析',
    icon: 'TrendingUp',
    sortOrder: 30,
    isLeaf: false,
    children: [
      {
        code: 'data.sales_analytics',
        name: '销售分析看板',
        path: '/data/sales-analytics',
        sortOrder: 10,
        isLeaf: true,
      },
      { code: 'data.products', name: '商品主数据', path: '/data/products', sortOrder: 20, isLeaf: true },
      { code: 'data.sales', name: '销量历史', path: '/data/sales', sortOrder: 30, isLeaf: true },
      { code: 'data.forecast', name: '销售预测', path: '/data/forecast', sortOrder: 40, isLeaf: true },
      {
        code: 'data.demand_plan',
        name: '需求计划-周',
        path: '/data/demand-plan',
        sortOrder: 50,
        isLeaf: true,
      },
    ],
  },
  {
    code: 'assistant',
    name: '智能助手',
    icon: 'Bot',
    sortOrder: 40,
    isLeaf: false,
    children: [
      { code: 'ai.chat', name: '知识问答', path: '/ai/chat', sortOrder: 10, isLeaf: true },
      { code: 'intel.news', name: '跨境资讯', path: '/intel/news', sortOrder: 20, isLeaf: true },
      { code: 'cs.quality', name: '客服回复评分', path: '/cs/quality', sortOrder: 30, isLeaf: true },
    ],
  },
  {
    code: 'help',
    name: '帮助中心',
    icon: 'HelpCircle',
    path: '/help',
    sortOrder: 90,
    isLeaf: true,
  },
  {
    code: 'system',
    name: '系统设置',
    icon: 'Settings',
    sortOrder: 100,
    isLeaf: false,
    children: [
      { code: 'system.users', name: '用户管理', path: '/system/users', sortOrder: 10, isLeaf: true },
      { code: 'system.roles', name: '角色与菜单', path: '/system/roles', sortOrder: 20, isLeaf: true },
      { code: 'system.tasks', name: '定时任务', path: '/system/tasks', sortOrder: 30, isLeaf: true },
      { code: 'system.logs', name: '操作日志', icon: 'ScrollText', path: '/system/logs', sortOrder: 40, isLeaf: true },
    ],
  },
];

/** 已合并到其他菜单的废弃项，seed 时清理（先子后父） */
const DEPRECATED_MENU_CODES = [
  'pmc.import',
  'pmc.drafts',
  'reorder',
  'reorder.suggestion',
  'reorder.forecast',
  'reorder.drafts',
  'system.menus',
  'logistics.fob_fee_rules',
  'compliance.overview',
  'compliance.skus',
  'compliance',
  'data.import',
  'data.forecast.strategy',
  'data.layered_forecast',
  'pmc',
  'procurement',
  'logistics',
  'cs',
  'ai',
  'intel',
];

const SUPPLY_MENU_CODES = [
  'supply',
  'pmc.suggestion',
  'pmc.list',
  'pmc.tracking',
  'pmc.shipments',
  'procurement.bulk_stock',
  'procurement.follow_up',
  'procurement.costing',
  'logistics.fob_settlement',
] as const;

const ASSISTANT_MENU_CODES = ['assistant', 'ai.chat', 'cs.quality', 'intel.news'] as const;

const DATA_MENU_CODES = [
  'data',
  'data.sales_analytics',
  'data.products',
  'data.sales',
  'data.forecast',
] as const;

const INVENTORY_MENU_CODES = [
  'inventory',
  'inventory.planning_dashboard',
  'inventory.alert',
  'inventory.overview',
  'inventory.planning',
  'inventory.pools',
  'inventory.query',
  'inventory.procurement_ops',
  'inventory.data_issues',
  'inventory.unallocated',
  'inventory.safety',
  'inventory.lead_time',
] as const;

const ROLE_MENU_CODES: Record<string, string[]> = {
  super_admin: [
    'dashboard',
    ...INVENTORY_MENU_CODES,
    ...SUPPLY_MENU_CODES,
    ...DATA_MENU_CODES,
    'data.demand_plan',
    ...ASSISTANT_MENU_CODES,
    'help',
    'system',
    'system.users',
    'system.roles',
    'system.logs',
    'system.tasks',
  ],
  pmc_planner: [
    'dashboard',
    ...INVENTORY_MENU_CODES,
    'supply',
    'pmc.suggestion',
    'pmc.list',
    'pmc.shipments',
    'procurement.bulk_stock',
    'logistics.fob_settlement',
    ...DATA_MENU_CODES,
    'data.demand_plan',
    'assistant',
    'ai.chat',
    'cs.quality',
    'help',
  ],
  warehouse: [
    'dashboard',
    'inventory',
    'inventory.overview',
    'inventory.alert',
    'inventory.query',
    'inventory.procurement_ops',
    'inventory.data_issues',
    'inventory.unallocated',
    'supply',
    'pmc.list',
    'logistics.fob_settlement',
    ...DATA_MENU_CODES,
    'assistant',
    'ai.chat',
    'cs.quality',
    'help',
  ],
  purchaser: [
    'dashboard',
    ...INVENTORY_MENU_CODES,
    ...SUPPLY_MENU_CODES,
    ...DATA_MENU_CODES,
    'assistant',
    'ai.chat',
    'cs.quality',
    'help',
  ],
  viewer: [
    'dashboard',
    'inventory',
    'inventory.overview',
    'inventory.query',
    'inventory.procurement_ops',
    'inventory.pools',
    'inventory.data_issues',
    'inventory.unallocated',
    'supply',
    'pmc.suggestion',
    'pmc.list',
    'pmc.tracking',
    'procurement.bulk_stock',
    'procurement.follow_up',
    'procurement.costing',
    'logistics.fob_settlement',
    ...DATA_MENU_CODES.filter((code) => code !== 'data.products'),
    'assistant',
    'ai.chat',
    'cs.quality',
    'help',
  ],
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
    const values = {
      code: item.code,
      name: item.name,
      icon: item.icon,
      path: item.path,
      parentId: parentId ?? null,
      sortOrder: item.sortOrder,
      isLeaf: item.isLeaf,
    };

    const [existing] = await db
      .select({ id: menus.id })
      .from(menus)
      .where(eq(menus.code, item.code))
      .limit(1);

    let menuId: string | undefined;
    if (existing) {
      await db.update(menus).set(values).where(eq(menus.id, existing.id));
      menuId = existing.id;
    } else {
      const [inserted] = await db.insert(menus).values(values).returning({ id: menus.id });
      menuId = inserted?.id;
    }

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
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim();
  if (adminRoleId) {
    const existing = await db.select().from(users).where(eq(users.email, 'admin@scm.local')).limit(1);
    if (!existing.length) {
      await db.insert(users).values({
        name: '系统管理员',
        email: 'admin@scm.local',
        roleId: adminRoleId,
        isActive: true,
        ...(bootstrapPassword ? { passwordHash: hashPassword(bootstrapPassword) } : {}),
      });
      console.log('Created default admin user: admin@scm.local');
    } else if (bootstrapPassword) {
      const forceSync = process.env.BOOTSTRAP_ADMIN_PASSWORD_FORCE === 'true';
      if (!existing[0].passwordHash || forceSync) {
        await db
          .update(users)
          .set({ passwordHash: hashPassword(bootstrapPassword) })
          .where(eq(users.email, 'admin@scm.local'));
        console.log(
          forceSync
            ? 'Synced bootstrap password for admin@scm.local'
            : 'Set bootstrap password for admin@scm.local',
        );
      }
    }
  }

  console.log('Seeding FOB fee allocation rules...');
  await seedFobFeeRules();

  console.log('Seeding FOB service providers...');
  await seedFobServiceProviders();

  console.log('Seed completed.');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
