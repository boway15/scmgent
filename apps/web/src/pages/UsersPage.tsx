import { Fragment, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { ChecklistSearchSelect } from '@/components/ChecklistSearchSelect';

export function UsersPage() {
  const qc = useQueryClient();
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetError, setResetError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [scopeUserId, setScopeUserId] = useState<string | null>(null);
  const [scopeDraft, setScopeDraft] = useState<string[]>([]);
  const [scopeSearch, setScopeSearch] = useState('');
  const [scopeOpen, setScopeOpen] = useState(false);
  const [scopeError, setScopeError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, pageSize, appliedKeyword],
    queryFn: () => api.getUsers({ page, pageSize, q: appliedKeyword || undefined }),
  });
  const users = data?.items ?? [];
  const { data: roles = [] } = useQuery({ queryKey: ['roles'], queryFn: api.getRoles });

  const scopeQuery = useQuery({
    queryKey: ['user-data-scopes', scopeUserId],
    queryFn: () => api.getUserDataScopes(scopeUserId!),
    enabled: Boolean(scopeUserId),
  });

  const projectGroupOptionsQuery = useQuery({
    queryKey: ['user-project-groups', scopeSearch],
    queryFn: () => api.searchUserProjectGroups(scopeSearch || undefined),
    enabled: Boolean(scopeUserId),
  });

  useEffect(() => {
    if (!scopeQuery.data) return;
    setScopeDraft(scopeQuery.data.projectGroups);
    setScopeError(null);
  }, [scopeQuery.data]);

  const updateUser = useMutation({
    mutationFn: ({ id, roleId, isActive }: { id: string; roleId?: string; isActive?: boolean }) =>
      api.updateUser(id, { roleId, isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) => api.resetUserPassword(id, password),
    onSuccess: () => {
      setResetUserId(null);
      setNewPassword('');
      setResetError(null);
    },
    onError: (err: Error) => {
      setResetError(err.message);
    },
  });

  const saveScope = useMutation({
    mutationFn: ({ id, projectGroups }: { id: string; projectGroups: string[] }) =>
      api.updateUserDataScopes(id, projectGroups),
    onSuccess: () => {
      setScopeError(null);
      qc.invalidateQueries({ queryKey: ['user-data-scopes', scopeUserId] });
      setScopeUserId(null);
      setScopeOpen(false);
    },
    onError: (err: Error) => {
      setScopeError(err.message);
    },
  });

  const handleResetSubmit = (userId: string) => {
    setResetError(null);
    if (newPassword.length < 8) {
      setResetError('密码至少 8 位');
      return;
    }
    resetPassword.mutate({ id: userId, password: newPassword });
  };

  const openScopeEditor = (userId: string) => {
    setResetUserId(null);
    setScopeUserId(scopeUserId === userId ? null : userId);
    setScopeSearch('');
    setScopeOpen(false);
    setScopeError(null);
  };

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="用户管理" />
      <Card>
        <CardHeader>
          <CardTitle>系统用户</CardTitle>
        </CardHeader>
        <CardContent>
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="姓名 / 邮箱 / 飞书 ID"
          />
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
                <Fragment key={u.id}>
                  <tr className="border-b border-border/60">
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
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateUser.mutate({ id: u.id, isActive: !u.isActive })}
                        >
                          {u.isActive ? '禁用' : '启用'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => openScopeEditor(u.id)}>
                          {scopeUserId === u.id ? '收起范围' : '数据范围'}
                        </Button>
                        {u.hasPassword && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setScopeUserId(null);
                              setResetUserId(resetUserId === u.id ? null : u.id);
                              setNewPassword('');
                              setResetError(null);
                            }}
                          >
                            {resetUserId === u.id ? '取消' : '重置密码'}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {scopeUserId === u.id && (
                    <tr className="border-b border-border/60 bg-muted/30">
                      <td colSpan={6} className="p-3">
                        <div className="space-y-3">
                          <div className="text-sm text-text-main">
                            为 <span className="font-medium">{u.name}</span> 配置可见项目组。
                            留空并保存表示看全部。
                          </div>
                          {scopeQuery.isLoading ? (
                            <p className="text-sm text-text-sub">加载数据范围...</p>
                          ) : (
                            <>
                              <p className="text-xs text-text-sub">
                                当前：
                                {scopeDraft.length === 0
                                  ? '全部'
                                  : `已选 ${scopeDraft.length} 个项目组`}
                              </p>
                              <ChecklistSearchSelect
                                value={scopeDraft}
                                onChange={setScopeDraft}
                                options={projectGroupOptionsQuery.data?.items ?? []}
                                isFetching={projectGroupOptionsQuery.isFetching}
                                search={scopeSearch}
                                onSearchChange={setScopeSearch}
                                open={scopeOpen}
                                onOpenChange={setScopeOpen}
                                placeholder="搜索项目组…"
                                allLabel="全部项目组（不限制）"
                                clearAriaLabel="清空已选项目组"
                                emptyHint="暂无项目组候选"
                                noMatchHint="无匹配项目组"
                                className="max-w-xl"
                              />
                              <div className="flex flex-wrap items-center gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setScopeDraft([])}
                                  disabled={scopeDraft.length === 0}
                                >
                                  设为全部
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() =>
                                    saveScope.mutate({ id: u.id, projectGroups: scopeDraft })
                                  }
                                  disabled={saveScope.isPending}
                                >
                                  {saveScope.isPending ? '保存中...' : '保存数据范围'}
                                </Button>
                                {scopeError && (
                                  <p className="text-sm text-red-600">{scopeError}</p>
                                )}
                              </div>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  {resetUserId === u.id && (
                    <tr className="border-b border-border/60 bg-muted/30">
                      <td colSpan={6} className="p-3">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="space-y-1">
                            <label className="text-xs text-text-sub">为 {u.email} 设置新密码</label>
                            <Input
                              type="password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              placeholder="至少 8 位"
                              className="w-64"
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleResetSubmit(u.id)}
                            disabled={resetPassword.isPending}
                          >
                            {resetPassword.isPending ? '保存中...' : '确认重置'}
                          </Button>
                          {resetError && <p className="text-sm text-red-600">{resetError}</p>}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {!users.length && (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-text-hint">
                    暂无用户，注册或飞书登录后将自动创建
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
