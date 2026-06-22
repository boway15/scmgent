import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  confirmed: '已确认',
  in_progress: '进行中',
  completed: '已完成',
  cancelled: '已取消',
};

export function PmcDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [receiveQty, setReceiveQty] = useState<Record<string, string>>({});

  const { data: plan, isLoading } = useQuery({
    queryKey: ['pmc-plan', id],
    queryFn: () => api.getPmcPlan(id!),
    enabled: !!id,
  });

  const receiveItem = useMutation({
    mutationFn: ({ itemId, qtyReceived, idempotencyKey }: { itemId: string; qtyReceived: number; idempotencyKey: string }) =>
      api.receivePmcPlanItem(id!, itemId, {
        qtyReceived,
        idempotencyKey,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pmc-plan', id] });
      qc.invalidateQueries({ queryKey: ['pmc-plans'] });
      qc.invalidateQueries({ queryKey: ['inventory-overview'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      setReceiveQty({});
    },
  });

  const updateStatus = useMutation({
    mutationFn: (status: string) => api.updatePmcPlanStatus(id!, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pmc-plan', id] });
      qc.invalidateQueries({ queryKey: ['pmc-plans'] });
      qc.invalidateQueries({ queryKey: ['purchase-tracking'] });
    },
  });

  const [exporting, setExporting] = useState(false);

  if (isLoading || !plan) return <p className="text-text-sub">加载中...</p>;

  const canReceive = plan.status === 'confirmed' || plan.status === 'in_progress';

  const handleExport = async () => {
    setExporting(true);
    try {
      await api.exportPmcPlanCsv(plan.id, plan.planNo);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={`计划 ${plan.planNo}`}>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} disabled={exporting}>
            {exporting ? '导出中...' : '导出计划单 (CSV)'}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              setExporting(true);
              try {
                await api.exportPmcPlan(plan.id, plan.planNo, 'xlsx');
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting}
          >
            导出 XLSX
          </Button>
          {plan.status === 'draft' && (
            <Button onClick={() => updateStatus.mutate('confirmed')} disabled={updateStatus.isPending}>
              确认计划并生成采购跟单
            </Button>
          )}
        </div>
      </PageHeader>
      <Card>
        <CardHeader>
          <CardTitle>{plan.name}</CardTitle>
          <p className="text-sm text-text-sub">
            商家 {plan.merchantName ?? plan.merchantCode} · 目标仓 {plan.targetWarehouseCode ?? '-'} · 计划日期{' '}
            {String(plan.planDate).slice(0, 10)} · 交期 {String(plan.deliveryDate).slice(0, 10)} · 状态{' '}
            {STATUS_LABEL[plan.status] ?? plan.status}
          </p>
          <p className="text-sm text-text-sub">
            确认前可先导出 CSV 发给商家；确认后使用「确认到货」回写库存，不再手工改已完成数量。
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">目标仓</th>
                <th className="p-2 font-normal">计划数量</th>
                <th className="p-2 font-normal">已到货</th>
                <th className="p-2 font-normal">待到货</th>
                {canReceive && <th className="p-2 font-normal">到货确认</th>}
              </tr>
            </thead>
            <tbody>
              {plan.items.map((item) => {
                const completed = item.completedQty ?? 0;
                const remaining = Math.max(item.plannedQty - completed, 0);
                return (
                  <tr key={item.id} className="border-b border-border/60">
                    <td className="p-2 font-mono">
                      {item.skuCode} — {item.skuName}
                    </td>
                    <td className="p-2 font-mono">{item.warehouseCode ?? plan.targetWarehouseCode ?? '-'}</td>
                    <td className="p-2 font-numeric">
                      {item.plannedQty} {item.unit}
                    </td>
                    <td className="p-2 font-numeric">{completed}</td>
                    <td className="p-2 font-numeric">{remaining}</td>
                    {canReceive && (
                      <td className="p-2">
                        {remaining > 0 ? (
                          <div className="flex items-center gap-2">
                            <Input
                              type="number"
                              className="h-8 w-24"
                              placeholder="数量"
                              value={receiveQty[item.id] ?? ''}
                              onChange={(e) =>
                                setReceiveQty((prev) => ({ ...prev, [item.id]: e.target.value }))
                              }
                            />
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={receiveItem.isPending || !receiveQty[item.id]}
                              onClick={() =>
                                receiveItem.mutate({
                                  itemId: item.id,
                                  qtyReceived: Number(receiveQty[item.id]),
                                  idempotencyKey: `${id}:${item.id}:${receiveQty[item.id]}`,
                                })
                              }
                            >
                              确认到货
                            </Button>
                          </div>
                        ) : (
                          <span className="text-text-hint">已完成</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {plan.status === 'draft' && (
            <p className="mt-4 text-sm text-text-sub">
              确认后将按各行数量生成采购跟单，可在{' '}
              <Link to="/pmc/tracking" className="text-primary hover:underline">
                采购跟单
              </Link>{' '}
              中查看内部履约记录。
            </p>
          )}
          {receiveItem.isError && (
            <p className="mt-4 text-sm text-destructive">{(receiveItem.error as Error).message}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
