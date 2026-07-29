import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type LeadTimeProfile, type LeadTimeProfileInput, type TransportMode } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type ProfileForm = {
  id?: string;
  merchantCode: string;
  originLocation: string;
  destinationWarehouseCode: string;
  transportMode: '' | TransportMode;
  productionDays: string;
  domesticDays: string;
  bookingDays: string;
  transitDays: string;
  customsDays: string;
  inboundDays: string;
  leadTimeStdDev: string;
  isDefault: boolean;
};

const EMPTY_FORM: ProfileForm = {
  merchantCode: '',
  originLocation: '',
  destinationWarehouseCode: '',
  transportMode: '',
  productionDays: '0',
  domesticDays: '0',
  bookingDays: '0',
  transitDays: '0',
  customsDays: '0',
  inboundDays: '0',
  leadTimeStdDev: '',
  isDefault: false,
};

const TRANSPORT_MODE_LABELS: Record<TransportMode, string> = {
  fcl: '整柜',
  lcl: '拼箱',
  air: '空运',
  express: '快递',
  rail: '铁路',
  truck_air: '卡航',
  direct: '直发',
};

const DAY_FIELDS = [
  ['productionDays', '生产'],
  ['domesticDays', '国内'],
  ['bookingDays', '订舱'],
  ['transitDays', '干线'],
  ['customsDays', '清关'],
  ['inboundDays', '入仓'],
] as const;

function profileToForm(profile: LeadTimeProfile): ProfileForm {
  return {
    id: profile.id,
    merchantCode: profile.merchantCode ?? '',
    originLocation: profile.originLocation ?? '',
    destinationWarehouseCode: profile.destinationWarehouseCode,
    transportMode: profile.transportMode ?? '',
    productionDays: String(profile.productionDays),
    domesticDays: String(profile.domesticDays),
    bookingDays: String(profile.bookingDays),
    transitDays: String(profile.transitDays),
    customsDays: String(profile.customsDays),
    inboundDays: String(profile.inboundDays),
    leadTimeStdDev: profile.leadTimeStdDev == null ? '' : String(profile.leadTimeStdDev),
    isDefault: profile.isDefault,
  };
}

function formToInput(form: ProfileForm): LeadTimeProfileInput {
  return {
    id: form.id,
    merchantCode: form.merchantCode || null,
    originLocation: form.originLocation || null,
    destinationWarehouseCode: form.destinationWarehouseCode,
    transportMode: form.transportMode || null,
    productionDays: Number(form.productionDays),
    domesticDays: Number(form.domesticDays),
    bookingDays: Number(form.bookingDays),
    transitDays: Number(form.transitDays),
    customsDays: Number(form.customsDays),
    inboundDays: Number(form.inboundDays),
    leadTimeStdDev: form.leadTimeStdDev === '' ? null : Number(form.leadTimeStdDev),
    isDefault: form.isDefault,
    sourceSystem: null,
    externalId: null,
  };
}

export function LeadTimeProfilesPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  const [filters, setFilters] = useState({ warehouse: '', merchant: '' });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const [error, setError] = useState('');

  const profiles = useQuery({
    queryKey: ['lead-time-profiles', appliedFilters],
    queryFn: () =>
      api.getLeadTimeProfiles({
        warehouse: appliedFilters.warehouse || undefined,
        merchant: appliedFilters.merchant || undefined,
      }),
  });

  const save = useMutation({
    mutationFn: (data: LeadTimeProfileInput) => api.upsertLeadTimeProfile(data),
    onSuccess: () => {
      setForm(EMPTY_FORM);
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['lead-time-profiles'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : '保存失败'),
  });

  const remove = useMutation({
    mutationFn: api.deleteLeadTimeProfile,
    onSuccess: () => {
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['lead-time-profiles'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : '删除失败'),
  });

  const items = profiles.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="交期配置" />

      <Card>
        <CardHeader>
          <CardTitle>{form.id ? '编辑交期 Profile' : '新建交期 Profile'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-4">
            <Input
              placeholder="仓库编码（必填）"
              value={form.destinationWarehouseCode}
              onChange={(event) =>
                setForm({ ...form, destinationWarehouseCode: event.target.value })
              }
            />
            <Input
              placeholder="商家编码（空=仓库默认）"
              value={form.merchantCode}
              onChange={(event) => setForm({ ...form, merchantCode: event.target.value })}
            />
            <Input
              placeholder="起运地"
              value={form.originLocation}
              onChange={(event) => setForm({ ...form, originLocation: event.target.value })}
            />
            <select
              className="h-10 rounded-md border border-border bg-card px-3 text-sm"
              value={form.transportMode}
              onChange={(event) =>
                setForm({ ...form, transportMode: event.target.value as ProfileForm['transportMode'] })
              }
            >
              <option value="">全部运输方式</option>
              {Object.entries(TRANSPORT_MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 md:grid-cols-6">
            {DAY_FIELDS.map(([field, label]) => (
              <label key={field} className="space-y-1 text-sm text-text-sub">
                <span>{label}天数</span>
                <Input
                  type="number"
                  min={0}
                  value={form[field]}
                  onChange={(event) => setForm({ ...form, [field]: event.target.value })}
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="w-40 space-y-1 text-sm text-text-sub">
              <span>波动标准差（天）</span>
              <Input
                type="number"
                min={0}
                value={form.leadTimeStdDev}
                onChange={(event) => setForm({ ...form, leadTimeStdDev: event.target.value })}
              />
            </label>
            <label className="flex h-10 items-center gap-2 text-sm text-text-sub">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(event) => setForm({ ...form, isDefault: event.target.checked })}
              />
              默认 Profile
            </label>
            <Button
              onClick={() => save.mutate(formToInput(form))}
              disabled={save.isPending || !form.destinationWarehouseCode.trim()}
            >
              {save.isPending ? '保存中...' : '保存'}
            </Button>
            {form.id && (
              <Button variant="outline" onClick={() => setForm(EMPTY_FORM)}>
                取消编辑
              </Button>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Profile 列表</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap gap-3">
            <Input
              className="w-52"
              placeholder="按仓库编码筛选"
              value={filters.warehouse}
              onChange={(event) => setFilters({ ...filters, warehouse: event.target.value })}
            />
            <Input
              className="w-52"
              placeholder="按商家编码筛选"
              value={filters.merchant}
              onChange={(event) => setFilters({ ...filters, merchant: event.target.value })}
            />
            <Button variant="outline" onClick={() => setAppliedFilters(filters)}>
              查询
            </Button>
          </div>

          {profiles.isLoading ? (
            <p className="text-sm text-text-sub">加载中...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">仓库</th>
                    <th className="p-2 font-normal">商家</th>
                    <th className="p-2 font-normal">方式</th>
                    {DAY_FIELDS.map(([, label]) => (
                      <th key={label} className="p-2 font-normal">{label}</th>
                    ))}
                    <th className="p-2 font-normal">合计</th>
                    <th className="p-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((profile) => {
                    const total = DAY_FIELDS.reduce((sum, [field]) => sum + profile[field], 0);
                    return (
                      <tr key={profile.id} className="border-b border-border/60">
                        <td className="p-2 font-mono">{profile.destinationWarehouseCode}</td>
                        <td className="p-2 font-mono">{profile.merchantCode ?? '默认'}</td>
                        <td className="p-2">
                          {profile.transportMode
                            ? TRANSPORT_MODE_LABELS[profile.transportMode]
                            : '全部'}
                        </td>
                        {DAY_FIELDS.map(([field]) => (
                          <td key={field} className="p-2 font-mono">{profile[field]}</td>
                        ))}
                        <td className="p-2 font-mono text-text-main">{total}</td>
                        <td className="whitespace-nowrap p-2">
                          <Button size="sm" variant="ghost" onClick={() => setForm(profileToForm(profile))}>
                            编辑
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={() => {
                              if (window.confirm('确认删除该交期 Profile？')) remove.mutate(profile.id);
                            }}
                          >
                            删除
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                  {!items.length && (
                    <tr>
                      <td colSpan={11} className="p-6 text-center text-text-hint">
                        暂无交期 Profile
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
