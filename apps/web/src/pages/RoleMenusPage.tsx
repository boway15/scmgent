import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type MenuNode } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { cn } from '@/lib/utils';
import { getDescendantIds, getAncestorIds, collectMenuIds } from '@/lib/menu-utils';

function MenuTreeCheckboxes({
  menus,
  selectedMenuIds,
  onToggle,
  disabled,
  depth = 0,
}: {
  menus: MenuNode[];
  selectedMenuIds: Set<string>;
  onToggle: (menu: MenuNode, checked: boolean) => void;
  disabled: boolean;
  depth?: number;
}) {
  return (
    <div className="space-y-1">
      {menus.map((menu) => (
        <div key={menu.id}>
          <label
            className="flex items-center gap-2 text-sm text-text-main"
            style={{ paddingLeft: `${depth * 16}px` }}
          >
            <input
              type="checkbox"
              className="rounded border-input"
              checked={selectedMenuIds.has(menu.id)}
              onChange={(e) => onToggle(menu, e.target.checked)}
              disabled={disabled}
            />
            <span>{menu.name}</span>
            <span className="text-text-sub">({menu.code})</span>
          </label>
          {menu.children?.length ? (
            <MenuTreeCheckboxes
              menus={menu.children}
              selectedMenuIds={selectedMenuIds}
              onToggle={onToggle}
              disabled={disabled}
              depth={depth + 1}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function RoleMenusPage() {
  const qc = useQueryClient();
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: api.getRoles });
  const { data: allMenus = [] } = useQuery({ queryKey: ['menus'], queryFn: api.getMenus });
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [selectedMenuIds, setSelectedMenuIds] = useState<Set<string>>(new Set());
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleCode, setNewRoleCode] = useState('');
  const [editRoleName, setEditRoleName] = useState('');

  const menuMap = collectMenuIds(allMenus);
  const selectedRole = roles.find((r) => r.id === selectedRoleId);

  const loadRoleMenus = useMutation({
    mutationFn: async (roleId: string) => {
      setSelectedRoleId(roleId);
      const role = roles.find((r) => r.id === roleId);
      setEditRoleName(role?.name ?? '');
      const rows = await api.getRoleMenus(roleId);
      setSelectedMenuIds(new Set(rows.map((r) => r.menuId)));
    },
  });

  const save = useMutation({
    mutationFn: () => api.updateRoleMenus(selectedRoleId, Array.from(selectedMenuIds)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['my-menus'] }),
  });

  const createRole = useMutation({
    mutationFn: () => api.createRole({ name: newRoleName.trim(), code: newRoleCode.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setNewRoleName('');
      setNewRoleCode('');
    },
  });

  const updateRole = useMutation({
    mutationFn: () => api.updateRole(selectedRoleId, { name: editRoleName.trim() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }),
  });

  const deleteRole = useMutation({
    mutationFn: () => api.deleteRole(selectedRoleId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] });
      setSelectedRoleId('');
      setSelectedMenuIds(new Set());
    },
  });

  const toggleMenu = (menu: MenuNode, checked: boolean) => {
    const next = new Set(selectedMenuIds);
    const descendantIds = getDescendantIds(menu);
    const idsToUpdate = [menu.id, ...descendantIds];

    if (checked) {
      idsToUpdate.forEach((id) => next.add(id));
      getAncestorIds(menu.id, menuMap).forEach((id) => next.add(id));
    } else {
      idsToUpdate.forEach((id) => next.delete(id));
    }
    setSelectedMenuIds(next);
  };

  return (
    <div className="space-y-6">
      <PageHeader title="角色与菜单" description="管理角色及每个角色可见的菜单项" />
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>角色列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {roles.map((role) => (
              <Button
                key={role.id}
                variant="outline"
                className={cn(
                  'w-full justify-start',
                  selectedRoleId === role.id && 'border-primary text-primary',
                )}
                onClick={() => loadRoleMenus.mutate(role.id)}
              >
                {role.name} ({role.code})
                {role.isSystem ? ' · 系统' : ''}
              </Button>
            ))}

            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <p className="text-sm font-medium text-text-main">新建角色</p>
              <Input placeholder="角色名称" value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} />
              <Input placeholder="角色 code（英文）" value={newRoleCode} onChange={(e) => setNewRoleCode(e.target.value)} />
              <Button
                size="sm"
                onClick={() => createRole.mutate()}
                disabled={!newRoleName.trim() || !newRoleCode.trim() || createRole.isPending}
              >
                创建角色
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>菜单配置</CardTitle>
            {selectedRoleId && (
              <Button onClick={() => save.mutate()} disabled={save.isPending}>
                保存菜单
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!selectedRoleId && <p className="text-text-sub">请先选择角色</p>}
            {selectedRole && (
              <div className="mb-4 flex flex-wrap items-end gap-2">
                <Input
                  className="max-w-xs"
                  value={editRoleName}
                  onChange={(e) => setEditRoleName(e.target.value)}
                  placeholder="角色名称"
                />
                <Button size="sm" variant="outline" onClick={() => updateRole.mutate()} disabled={updateRole.isPending}>
                  保存名称
                </Button>
                {!selectedRole.isSystem && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-primary"
                    onClick={() => deleteRole.mutate()}
                    disabled={deleteRole.isPending}
                  >
                    删除角色
                  </Button>
                )}
              </div>
            )}
            <MenuTreeCheckboxes
              menus={allMenus}
              selectedMenuIds={selectedMenuIds}
              onToggle={toggleMenu}
              disabled={!selectedRoleId}
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
