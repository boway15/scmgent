import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, menus, roleMenus } from '@scm/db';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireSuperAdmin } from '../middleware/auth.js';

type MenuRow = {
  id: string;
  name: string;
  code: string;
  icon: string | null;
  path: string | null;
  parentId: string | null;
  sortOrder: number;
  isLeaf: boolean;
};

type MenuNode = MenuRow & { children: MenuNode[] };

function buildMenuTree(items: MenuRow[]): MenuNode[] {
  const map = new Map<string, MenuNode>();
  const roots: MenuNode[] = [];

  for (const item of items) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const item of items) {
    const node = map.get(item.id)!;
    if (item.parentId && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: MenuNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder);
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(roots);

  return roots;
}

async function expandMenuIdsWithAncestors(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];

  const allIds = new Set(ids);
  let frontier = [...ids];

  while (frontier.length) {
    const rows = await db
      .select({ id: menus.id, parentId: menus.parentId })
      .from(menus)
      .where(inArray(menus.id, frontier));

    const next: string[] = [];
    for (const row of rows) {
      if (row.parentId && !allIds.has(row.parentId)) {
        allIds.add(row.parentId);
        next.push(row.parentId);
      }
    }
    frontier = next;
  }

  return [...allIds];
}

export const menuRoutes = new Hono();

menuRoutes.get('/me/menus', async (c) => {
  const user = await getCurrentUser(c);

  let menuRows: MenuRow[];

  if (user.role.code === 'super_admin') {
    menuRows = await db
      .select({
        id: menus.id,
        name: menus.name,
        code: menus.code,
        icon: menus.icon,
        path: menus.path,
        parentId: menus.parentId,
        sortOrder: menus.sortOrder,
        isLeaf: menus.isLeaf,
      })
      .from(menus)
      .orderBy(menus.sortOrder);
  } else {
    const roleMenuIds = await db
      .select({ menuId: roleMenus.menuId })
      .from(roleMenus)
      .where(eq(roleMenus.roleId, user.role.id));

    const ids = roleMenuIds.map((r) => r.menuId);
    if (!ids.length) return c.json([]);

    const expandedIds = await expandMenuIdsWithAncestors(ids);

    menuRows = await db
      .select({
        id: menus.id,
        name: menus.name,
        code: menus.code,
        icon: menus.icon,
        path: menus.path,
        parentId: menus.parentId,
        sortOrder: menus.sortOrder,
        isLeaf: menus.isLeaf,
      })
      .from(menus)
      .where(inArray(menus.id, expandedIds))
      .orderBy(menus.sortOrder);
  }

  return c.json(buildMenuTree(menuRows));
});

menuRoutes.get('/menus', requireSuperAdmin, async (c) => {
  const menuRows = await db
    .select({
      id: menus.id,
      name: menus.name,
      code: menus.code,
      icon: menus.icon,
      path: menus.path,
      parentId: menus.parentId,
      sortOrder: menus.sortOrder,
      isLeaf: menus.isLeaf,
    })
    .from(menus)
    .orderBy(menus.sortOrder);

  return c.json(buildMenuTree(menuRows));
});
