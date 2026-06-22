import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';

export function UsersPage() {
  const qc = useQueryClient();
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: api.getUsers,
  });
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: api.getRoles });

  const updateUser = useMutation({
    mutationFn: ({ id, roleId, isActive }: { id: string; roleId?: string; isActive?: boolean }) =>
      api.updateUser(id, { roleId, isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="用户管理" />
      <Card>
        <CardHeader>
          <CardTitle>飞书用户</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">姓名</th>
                <th className="p-2 font-normal">邮箱</th>
                <th className="p-2 font-normal">飞书 ID</th>
                <th className="p-2 font-normal">角色</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border/60">
                  <td className="p-2 text-text-main">{u.name}</td>
                  <td className="p-2 text-text-sub">{u.email}</td>
                  <td className="p-2 font-mono text-xs text-text-hint">{u.feishuUserId ?? '-'}</td>
                  <td className="p-2">
                    <select
                      className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                      value={u.roleId}
                      onChange={(e) => updateUser.mutate({ id: u.id, roleId: e.target.value })}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2 text-text-main">{u.isActive ? '启用' : '禁用'}</td>
                  <td className="p-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateUser.mutate({ id: u.id, isActive: !u.isActive })}
                    >
                      {u.isActive ? '禁用' : '启用'}
                    </Button>
                  </td>
                </tr>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-text-hint">
                    暂无用户，飞书登录后将自动创建
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
