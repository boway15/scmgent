import { NavLink } from 'react-router-dom';
import { getMenuIcon } from '@/lib/menu-utils';
import type { MenuNode } from '@/lib/api';
import { cn } from '@/lib/utils';

function MenuItem({ menu, depth = 0 }: { menu: MenuNode; depth?: number }) {
  const Icon = getMenuIcon(menu.icon);
  const hasChildren = menu.children && menu.children.length > 0;

  if (hasChildren) {
    return (
      <div className="space-y-1">
        <div
          className="flex items-center gap-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-hint"
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
          <Icon className="h-4 w-4" />
          {menu.name}
        </div>
        {menu.children!.map((child) => (
          <MenuItem key={child.id} menu={child} depth={depth + 1} />
        ))}
      </div>
    );
  }

  if (!menu.path) return null;

  return (
    <NavLink
      to={menu.path}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-accent font-medium text-primary'
            : 'text-text-sub hover:bg-muted hover:text-text-main',
        )
      }
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
    >
      <Icon className="h-4 w-4" />
      {menu.name}
    </NavLink>
  );
}

export function Sidebar({ menus }: { menus: MenuNode[] }) {
  return (
    <aside className="flex w-64 flex-col border-r border-border/60 bg-card shadow-card">
      <div className="flex h-14 items-center border-b border-border/60 px-4">
        <span className="text-lg font-bold text-primary">SCM Agent</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {menus.map((menu) => (
          <MenuItem key={menu.id} menu={menu} />
        ))}
      </nav>
    </aside>
  );
}
