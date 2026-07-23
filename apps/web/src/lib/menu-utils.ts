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

/** 路由别名：旧路径 / 重定向入口 → 实际授权菜单 */
const RELATED_PATH_ACCESS: Record<string, string> = {
  '/logistics/fob-fee-rules': '/logistics/fob-settlement',
  '/system/menus': '/system/roles',
};

/** 登录后默认落地页：超级管理员进看板，其余取首个可访问菜单 */
export function getDefaultHomePath(menus: MenuNode[], roleCode?: string): string {
  if (roleCode === 'super_admin') return '/dashboard';
  return flattenMenuPaths(menus)[0] ?? '/dashboard';
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
  if (normalized === '/') return allowedPaths.length > 0;

  const normalizedAllowed = allowedPaths.map(normalizePath);
  const related = RELATED_PATH_ACCESS[normalized];
  if (related) {
    const relatedNorm = normalizePath(related);
    if (normalizedAllowed.some((p) => relatedNorm === p || relatedNorm.startsWith(`${p}/`))) {
      return true;
    }
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
