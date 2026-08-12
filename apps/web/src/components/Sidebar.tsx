import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  collectMenuIds,
  getAncestorIds,
  getMenuIcon,
  normalizePath,
} from '@/lib/menu-utils';
import type { MenuNode } from '@/lib/api';
import { cn } from '@/lib/utils';

/** 按路径最长前缀匹配当前菜单叶子，用于自动展开所属一级 */
function findBestMatchingMenu(menus: MenuNode[], path: string): MenuNode | undefined {
  const target = normalizePath(path);
  let best: MenuNode | undefined;
  let bestLen = -1;

  const walk = (items: MenuNode[]) => {
    for (const menu of items) {
      if (menu.path) {
        const p = normalizePath(menu.path);
        if (target === p || target.startsWith(`${p}/`)) {
          if (p.length > bestLen) {
            best = menu;
            bestLen = p.length;
          }
        }
      }
      if (menu.children?.length) walk(menu.children);
    }
  };

  walk(menus);
  return best;
}

function MenuItem({
  menu,
  depth = 0,
  expandedIds,
  onToggle,
}: {
  menu: MenuNode;
  depth?: number;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  const Icon = getMenuIcon(menu.icon);
  const hasChildren = Boolean(menu.children?.length);
  const isExpanded = expandedIds.has(menu.id);

  if (hasChildren) {
    return (
      <div className="space-y-1">
        <button
          type="button"
          onClick={() => onToggle(menu.id)}
          aria-expanded={isExpanded}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wider text-text-hint transition-colors hover:bg-muted hover:text-text-sub"
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{menu.name}</span>
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
        </button>
        {isExpanded &&
          menu.children!.map((child) => (
            <MenuItem
              key={child.id}
              menu={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
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
  const location = useLocation();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const matched = findBestMatchingMenu(menus, location.pathname);
    if (!matched) return;

    const menuMap = collectMenuIds(menus);
    const ancestors = getAncestorIds(matched.id, menuMap);
    if (ancestors.length === 0) return;

    setExpandedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestors) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [location.pathname, menus]);

  const onToggle = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <aside className="flex w-64 flex-col border-r border-border/60 bg-card shadow-card">
      <div className="flex h-14 items-center border-b border-border/60 px-4">
        <span className="text-lg font-bold text-primary">AJ-Agent</span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {menus.map((menu) => (
          <MenuItem
            key={menu.id}
            menu={menu}
            expandedIds={expandedIds}
            onToggle={onToggle}
          />
        ))}
      </nav>
    </aside>
  );
}
