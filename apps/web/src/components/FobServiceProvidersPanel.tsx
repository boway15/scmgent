import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ProviderFilter = 'all' | 'trucking' | 'freight';
type FobServiceProvider = Awaited<ReturnType<typeof api.getFobServiceProviders>>[number];

const PROVIDER_TYPE_LABEL: Record<'trucking' | 'freight', string> = {
  trucking: '拖车',
  freight: '货代',
};

const emptyForm = {
  code: '',
  name: '',
  providerType: 'trucking' as 'trucking' | 'freight',
  sortOrder: '10',
  remark: '',
};

export function FobServiceProvidersPanel() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<ProviderFilter>('all');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  const { data: providers = [], isLoading } = useQuery({
    queryKey: ['fob-service-providers', filter],
    queryFn: () =>
      api.getFobServiceProviders(filter === 'all' ? undefined : { providerType: filter }),
  });

  const createProvider = useMutation({
    mutationFn: () =>
      api.createFobServiceProvider({
        code: form.code.trim(),
        name: form.name.trim(),
        providerType: form.providerType,
        sortOrder: Number(form.sortOrder) || 10,
        remark: form.remark.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fob-service-providers'] });
      closeForm();
    },
    onError: (e: Error) => setError(e.message),
  });

  const updateProvider = useMutation({
    mutationFn: (payload: {
      id: string;
      name?: string;
      providerType?: 'trucking' | 'freight';
      sortOrder?: number;
      remark?: string | null;
    }) => api.updateFobServiceProvider(payload.id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fob-service-providers'] });
      closeForm();
    },
    onError: (e: Error) => setError(e.message),
  });

  const toggleProvider = useMutation({
    mutationFn: (id: string) => api.toggleFobServiceProvider(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fob-service-providers'] }),
    onError: (e: Error) => setError(e.message),
  });

  const grouped = useMemo(() => {
    const trucking = providers.filter((p) => p.providerType === 'trucking');
    const freight = providers.filter((p) => p.providerType === 'freight');
    if (filter === 'trucking') return [{ title: '拖车服务商', rows: trucking }];
    if (filter === 'freight') return [{ title: '货代服务商', rows: freight }];
    return [
      { title: '拖车服务商', rows: trucking },
      { title: '货代服务商', rows: freight },
    ];
  }, [providers, filter]);

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
    setError('');
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
    setShowForm(true);
  };

  const openEdit = (provider: FobServiceProvider) => {
    setEditingId(provider.id);
    setForm({
      code: provider.code,
      name: provider.name,
      providerType: provider.providerType,
      sortOrder: String(provider.sortOrder),
      remark: provider.remark ?? '',
    });
    setError('');
    setShowForm(true);
  };

  const saveForm = () => {
    if (editingId) {
      updateProvider.mutate({
        id: editingId,
        name: form.name.trim(),
        providerType: form.providerType,
        sortOrder: Number(form.sortOrder) || 10,
        remark: form.remark.trim() || null,
      });
    } else {
      createProvider.mutate();
    }
  };

  const isSaving = createProvider.isPending || updateProvider.isPending;

  if (isLoading) return <p className="text-text-sub">加载服务商中...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-sub">
          配置拖车/货代服务商。创建分账批次时按类型选择对应服务商；账单导入按 Excel 表头自动识别格式。
        </p>
        <Button size="sm" onClick={() => (showForm ? closeForm() : openCreate())}>
          {showForm ? '取消' : '新增服务商'}
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', '全部'],
            ['trucking', '拖车'],
            ['freight', '货代'],
          ] as const
        ).map(([key, label]) => (
          <Button
            key={key}
            size="sm"
            variant={filter === key ? 'default' : 'outline'}
            onClick={() => setFilter(key)}
          >
            {label}
          </Button>
        ))}
      </div>

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editingId ? '编辑服务商' : '新增服务商'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            <Input
              placeholder="编码（唯一）"
              value={form.code}
              disabled={!!editingId}
              onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            />
            <Input
              placeholder="名称"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
            <select
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              value={form.providerType}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  providerType: e.target.value as 'trucking' | 'freight',
                }))
              }
            >
              <option value="trucking">拖车</option>
              <option value="freight">货代</option>
            </select>
            <Input
              placeholder="排序（越小越靠前）"
              value={form.sortOrder}
              onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
            />
            <Input
              className="md:col-span-2 lg:col-span-3"
              placeholder="备注（可选）"
              value={form.remark}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
            />
            <div className="flex gap-2 md:col-span-2 lg:col-span-3">
              <Button
                disabled={
                  isSaving ||
                  !form.name.trim() ||
                  (!editingId && !form.code.trim())
                }
                onClick={saveForm}
              >
                保存
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {grouped.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle className="text-base">{group.title}</CardTitle>
            <p className="text-sm text-text-sub">{group.rows.length} 个服务商</p>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="p-2 font-normal">编码</th>
                  <th className="p-2 font-normal">名称</th>
                  <th className="p-2 font-normal">类型</th>
                  <th className="p-2 font-normal">排序</th>
                  <th className="p-2 font-normal">状态</th>
                  <th className="p-2 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((provider) => (
                  <tr
                    key={provider.id}
                    className={cn('border-b border-border/40', !provider.isActive && 'opacity-50')}
                  >
                    <td className="p-2 font-mono">{provider.code}</td>
                    <td className="p-2">{provider.name}</td>
                    <td className="p-2">{PROVIDER_TYPE_LABEL[provider.providerType]}</td>
                    <td className="p-2 font-numeric">{provider.sortOrder}</td>
                    <td className="p-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className={provider.isActive ? 'text-emerald-700' : 'text-text-hint'}
                        disabled={toggleProvider.isPending}
                        onClick={() => toggleProvider.mutate(provider.id)}
                      >
                        {provider.isActive ? '启用' : '停用'}
                      </Button>
                    </td>
                    <td className="p-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isSaving}
                        onClick={() => openEdit(provider)}
                      >
                        编辑
                      </Button>
                    </td>
                  </tr>
                ))}
                {!group.rows.length && (
                  <tr>
                    <td colSpan={6} className="p-4 text-center text-text-hint">
                      暂无服务商
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
