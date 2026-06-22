import { eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { db, menus, roleMenus } from '../_db';
import { getCurrentUser } from '../lib/auth-context';
import { requireSuperAdmin } from '../middleware/auth';

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
      .where(inArray(menus.id, ids))
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
