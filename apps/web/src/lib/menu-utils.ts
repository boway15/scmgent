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
};

export function getMenuIcon(icon?: string | null): LucideIcon {
  if (!icon) return LayoutDashboard;
  return ICON_MAP[icon] ?? LayoutDashboard;
}

export function flattenMenuPaths(menus: MenuNode[]): string[] {
  const paths: string[] = [];
  for (const menu of menus) {
    if (menu.path) paths.push(menu.path);
    if (menu.children?.length) paths.push(...flattenMenuPaths(menu.children));
  }
  return paths;
}

export function findMenuByPath(menus: MenuNode[], path: string): MenuNode | undefined {
  for (const menu of menus) {
    if (menu.path === path) return menu;
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
  return allowedPaths.some((p) => path === p || path.startsWith(`${p}/`));
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
