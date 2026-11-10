import {
  Package,
  ClipboardList,
  TrendingUp,
  Bot,
  Settings,
  LayoutDashboard,
  Truck,
  Shield,
  HelpCircle,
  ScrollText,
  ShoppingCart,
  Headphones,
  Newspaper,
  Receipt,
  ClipboardCheck,
  Ship,
  Download,
  type LucideIcon,
} from 'lucide-react';
import type { MenuNode } from '@/lib/api';

const ICON_MAP: Record<string, LucideIcon> = {
  Package,
  ClipboardList,
  TrendingUp,
  Bot,
  Settings,
  LayoutDashboard,
  Truck,
  Shield,
  HelpCircle,
  ScrollText,
  ShoppingCart,
  Headphones,
  Newspaper,
  Receipt,
  ClipboardCheck,
  Ship,
  Download,
};

export function getMenuIcon(icon?: string | null): LucideIcon {
  if (!icon) return LayoutDashboard;
  return ICON_MAP[icon] ?? LayoutDashboard;
}

export function flattenMenuPaths(menus: MenuNode[]): string[] {
  const paths: string[] = [];
  for (const menu of menus) {
    if (menu.path) paths.push(normalizePath(menu.path));
    if (menu.children?.length) paths.push(...flattenMenuPaths(menu.children));
  }
  return paths;
}

export function normalizePath(path: string): string {
  if (!path || path === '/') return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

/** 登录即可访问，不依赖角色菜单（与帮助中心一致） */
export const OPEN_ACCESS_PATHS = ['/help', '/downloads'] as const;

/** 侧栏不展示，改由顶栏入口进入的菜单 code */
export const TOP_NAV_ONLY_MENU_CODES = new Set(['help', 'downloads']);

/** 路由别名：旧路径 / 重定向入口 → 实际授权菜单 */
const RELATED_PATH_ACCESS: Record<string, string> = {
  '/logistics/fob-fee-rules': '/logistics/fob-settlement',
  '/system/menus': '/system/roles',
  '/inventory/query': '/inventory/overview',
  '/inventory/procurement-ops': '/inventory/overview',
  '/inventory/unallocated': '/inventory/pools',
  '/inventory/lead-time': '/inventory/safety',
  '/inventory/planning': '/inventory/planning-dashboard',
};

const PLANNING_HOME_PATH = '/inventory/planning-dashboard';

/** 登录后默认落地页：超级管理员进规划驾驶舱，其余取首个可访问菜单 */
export function getDefaultHomePath(menus: MenuNode[], roleCode?: string): string {
  if (roleCode === 'super_admin') return PLANNING_HOME_PATH;
  return flattenMenuPaths(menus)[0] ?? PLANNING_HOME_PATH;
}

export function hasAnyMenuAccess(menus: MenuNode[], roleCode?: string): boolean {
  if (roleCode === 'super_admin') return true;
  return flattenMenuPaths(menus).length > 0;
}

export function findMenuByPath(menus: MenuNode[], path: string): MenuNode | undefined {
  const target = normalizePath(path);
  for (const menu of menus) {
    if (menu.path && normalizePath(menu.path) === target) return menu;
    if (menu.children?.length) {
      const found = findMenuByPath(menu.children, path);
      if (found) return found;
    }
  }
  return undefined;
}

export function canAccessPath(
  path: string,
  allowedPaths: string[],
  roleCode?: string,
): boolean {
  if (roleCode === 'super_admin') return true;

  const normalized = normalizePath(path);
  if (OPEN_ACCESS_PATHS.some((p) => normalized === p || normalized.startsWith(`${p}/`))) {
    return true;
  }
  if (normalized === '/') return allowedPaths.length > 0;

  const normalizedAllowed = allowedPaths.map(normalizePath);
  const related = RELATED_PATH_ACCESS[normalized];
  if (related) {
    const relatedNorm = normalizePath(related);
    if (normalizedAllowed.some((p) => relatedNorm === p || relatedNorm.startsWith(`${p}/`))) {
      return true;
    }
  }

  if (
    normalized.startsWith('/inventory/planning/') &&
    normalizedAllowed.some(
      (p) => p === '/inventory/planning' || p === '/inventory/planning-dashboard',
    )
  ) {
    return true;
  }

  return normalizedAllowed.some((p) => normalized === p || normalized.startsWith(`${p}/`));
}

export function collectMenuIds(menus: MenuNode[]): Map<string, MenuNode & { parentId?: string | null }> {
  const map = new Map<string, MenuNode & { parentId?: string | null }>();
  const walk = (items: MenuNode[], parentId: string | null = null) => {
    for (const menu of items) {
      map.set(menu.id, { ...menu, parentId });
      if (menu.children?.length) walk(menu.children, menu.id);
    }
  };
  walk(menus);
  return map;
}

export function getDescendantIds(menu: MenuNode): string[] {
  const ids: string[] = [];
  for (const child of menu.children ?? []) {
    ids.push(child.id, ...getDescendantIds(child));
  }
  return ids;
}

export function getAncestorIds(
  menuId: string,
  menuMap: Map<string, MenuNode & { parentId?: string | null }>,
): string[] {
  const ancestors: string[] = [];
  let currentId: string | undefined = menuId;
  while (currentId) {
    const current = menuMap.get(currentId);
    if (!current?.parentId) break;
    ancestors.push(current.parentId);
    currentId = current.parentId;
  }
  return ancestors;
}

export type FlatMenu = MenuNode & { parentId?: string | null };

export function flattenMenusWithParent(
  menus: MenuNode[],
  parentId: string | null = null,
): FlatMenu[] {
  const result: FlatMenu[] = [];
  for (const menu of menus) {
    result.push({ ...menu, parentId });
    if (menu.children?.length) {
      result.push(...flattenMenusWithParent(menu.children, menu.id));
    }
  }
  return result;
}

/** 侧栏菜单：去掉帮助中心 / 下载中心（改由顶栏进入） */
export function menusForSidebar(menus: MenuNode[]): MenuNode[] {
  return menus
    .filter((menu) => !TOP_NAV_ONLY_MENU_CODES.has(menu.code))
    .map((menu) =>
      menu.children?.length
        ? { ...menu, children: menusForSidebar(menu.children) }
        : menu,
    );
}
