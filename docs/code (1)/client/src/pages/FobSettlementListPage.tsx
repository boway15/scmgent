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
import { cn, formatDateTimeCst } from '@/lib/utils';

type TabKey = 'batches' | 'rules';

export function FobSettlementListPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = searchParams.get('tab') === 'rules' ? 'rules' : 'batches';

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['fob-settlements'],
    queryFn: api.getFobSettlements,
    enabled: tab === 'batches',
  });

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    name: '',
    settlementPeriod: new Date().toISOString().slice(0, 7),
  });

  const createBatch = useMutation({
    mutationFn: () =>
      api.createFobSettlement({
        name: form.name,
        settlementPeriod: form.settlementPeriod,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fob-settlements'] });
      setShowForm(false);
    },
  });

  const setTab = (next: TabKey) => {
    if (next === 'batches') {
      searchParams.delete('tab');
      setSearchParams(searchParams, { replace: true });
    } else {
      setSearchParams({ tab: 'rules' }, { replace: true });
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
      ) : (
        <>
          {showForm && (
            <Card>
              <CardContent className="grid gap-2 pt-6 md:grid-cols-4">
                <Input
                  placeholder="批次名称，如 2026年1月分账"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <Input
                  type="month"
                  value={form.settlementPeriod}
                  onChange={(e) => setForm({ ...form, settlementPeriod: e.target.value })}
                />
                <Button
                  variant="outline"
                  onClick={() => createBatch.mutate()}
                  disabled={!form.name || createBatch.isPending}
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
                      <td className="p-2">{b.createdByName ?? '—'}</td>
                      <td className="p-2 text-text-sub">{formatDateTimeCst(b.createdAt)}</td>
                      <td className="p-2">
                        <FobBatchStatusBadge status={b.status} />
                      </td>
                    </tr>
                  ))}
                  {!batches.length && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-text-hint">
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
