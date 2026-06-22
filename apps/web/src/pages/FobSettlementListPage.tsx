import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { FobBatchStatusBadge } from '@/components/FobStatusBadge';
import { FobFeeRulesPanel } from '@/components/FobFeeRulesPanel';
import { FobServiceProvidersPanel } from '@/components/FobServiceProvidersPanel';
import { cn, formatDateTimeCst } from '@/lib/utils';

type TabKey = 'batches' | 'rules' | 'service-providers';

const SETTLEMENT_TYPE_LABEL: Record<'trucking' | 'freight', string> = {
  trucking: '拖车分账',
  freight: '货代分账',
};

function parseTab(param: string | null): TabKey {
  if (param === 'rules') return 'rules';
  if (param === 'service-providers') return 'service-providers';
  return 'batches';
}

export function FobSettlementListPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['fob-settlements'],
    queryFn: api.getFobSettlements,
    enabled: tab === 'batches',
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    settlementPeriod: new Date().toISOString().slice(0, 7),
    settlementType: '' as '' | 'trucking' | 'freight',
    serviceProviderId: '',
  });

  const { data: providers = [] } = useQuery({
    queryKey: ['fob-service-providers', form.settlementType],
    queryFn: () =>
      api.getFobServiceProviders({
        providerType: form.settlementType as 'trucking' | 'freight',
        activeOnly: true,
      }),
    enabled: showForm && tab === 'batches' && !!form.settlementType,
  });

  const createBatch = useMutation({
    mutationFn: () => {
      if (!form.settlementType) {
        throw new Error('请选择分账类型');
      }
      return api.createFobSettlement({
        name: form.name,
        settlementPeriod: form.settlementPeriod,
        settlementType: form.settlementType,
        serviceProviderId: form.serviceProviderId,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fob-settlements'] });
      setShowForm(false);
      setForm({
        name: '',
        settlementPeriod: new Date().toISOString().slice(0, 7),
        settlementType: '',
        serviceProviderId: '',
      });
    },
  });

  const setTab = (next: TabKey) => {
    if (next === 'batches') {
      searchParams.delete('tab');
      setSearchParams(searchParams, { replace: true });
    } else {
      setSearchParams({ tab: next }, { replace: true });
    }
  };

  if (tab === 'batches' && isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="FOB 分账">
        {tab === 'batches' && (
          <Button onClick={() => setShowForm(!showForm)}>{showForm ? '取消' : '新建批次'}</Button>
        )}
      </PageHeader>

      <nav className="flex gap-1 border-b border-border">
        {(
          [
            ['batches', '核算批次'],
            ['rules', '分摊规则'],
            ['service-providers', '服务商'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'relative -mb-px border-b-2 px-4 py-2.5 text-sm transition-colors',
              tab === key
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-text-sub hover:text-text-main',
            )}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'rules' ? (
        <FobFeeRulesPanel />
      ) : tab === 'service-providers' ? (
        <FobServiceProvidersPanel />
      ) : (
        <>
          {showForm && (
            <Card>
              <CardContent className="flex items-center gap-3 pt-6">
                <Input
                  className="min-w-0 flex-[2]"
                  placeholder="批次名称，如 2026年1月分账"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <Input
                  className="w-[148px] shrink-0"
                  type="month"
                  value={form.settlementPeriod}
                  onChange={(e) => setForm({ ...form, settlementPeriod: e.target.value })}
                />
                <select
                  className="h-10 w-[132px] shrink-0 rounded-md border border-input bg-card px-3 text-sm"
                  value={form.settlementType}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((f) => ({
                      ...f,
                      settlementType: value as '' | 'trucking' | 'freight',
                      serviceProviderId: '',
                    }));
                  }}
                >
                  <option value="">请选择类型</option>
                  <option value="trucking">拖车分账</option>
                  <option value="freight">货代分账</option>
                </select>
                <select
                  className="h-10 min-w-0 flex-[1.5] rounded-md border border-input bg-card px-3 text-sm disabled:opacity-50"
                  value={form.serviceProviderId}
                  disabled={!form.settlementType}
                  onChange={(e) => setForm({ ...form, serviceProviderId: e.target.value })}
                >
                  <option value="">选择服务商</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.code})
                    </option>
                  ))}
                </select>
                <Button
                  className="shrink-0"
                  variant="outline"
                  onClick={() => createBatch.mutate()}
                  disabled={
                    !form.name ||
                    !form.settlementType ||
                    !form.serviceProviderId ||
                    createBatch.isPending
                  }
                >
                  创建
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>核算批次</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">编号</th>
                    <th className="p-2 font-normal">名称</th>
                    <th className="p-2 font-normal">账期</th>
                    <th className="p-2 font-normal">分账类型</th>
                    <th className="p-2 font-normal">服务商</th>
                    <th className="p-2 font-normal">创建人</th>
                    <th className="p-2 font-normal">创建时间</th>
                    <th className="p-2 font-normal">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map((b) => (
                    <tr key={b.id} className="border-b border-border/60">
                      <td className="p-2 font-mono">
                        <Link
                          to={`/logistics/fob-settlement/${b.id}`}
                          className="text-primary hover:underline"
                        >
                          {b.batchNo}
                        </Link>
                      </td>
                      <td className="p-2">{b.name}</td>
                      <td className="p-2">{b.settlementPeriod}</td>
                      <td className="p-2">{SETTLEMENT_TYPE_LABEL[b.settlementType]}</td>
                      <td className="p-2">{b.serviceProvider?.name ?? '—'}</td>
                      <td className="p-2">{b.createdByName ?? '—'}</td>
                      <td className="p-2 text-text-sub">{formatDateTimeCst(b.createdAt)}</td>
                      <td className="p-2">
                        <FobBatchStatusBadge status={b.status} />
                      </td>
                    </tr>
                  ))}
                  {!batches.length && (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-text-hint">
                        暂无批次，点击「新建批次」开始
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
