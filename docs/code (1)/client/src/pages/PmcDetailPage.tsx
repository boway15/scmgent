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

  const { data: plan, isLoading } = useQuery({
    queryKey: ['pmc-plan', id],
    queryFn: () => api.getPmcPlan(id!),
    enabled: !!id,
  });

  const updateItem = useMutation({
    mutationFn: ({ itemId, completedQty }: { itemId: string; completedQty: number }) =>
      api.updatePmcPlanItem(id!, itemId, { completedQty }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pmc-plan', id] }),
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
            确认前可先导出 CSV 发给商家；确认后系统生成内部采购跟单，请自行通过飞书等方式下发计划。
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">目标仓</th>
                <th className="p-2 font-normal">计划数量</th>
                <th className="p-2 font-normal">已完成</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map((item) => (
                <tr key={item.id} className="border-b border-border/60">
                  <td className="p-2 font-mono">
                    {item.skuCode} — {item.skuName}
                  </td>
                  <td className="p-2 font-mono">{item.warehouseCode ?? plan.targetWarehouseCode ?? '-'}</td>
                  <td className="p-2 font-numeric">
                    {item.plannedQty} {item.unit}
                  </td>
                  <td className="p-2 font-numeric">{item.completedQty ?? 0}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        className="h-8 w-24"
                        defaultValue={item.completedQty ?? 0}
                        onBlur={(e) => {
                          const v = +e.target.value;
                          if (v !== (item.completedQty ?? 0)) {
                            updateItem.mutate({ itemId: item.id, completedQty: v });
                          }
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
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
        </CardContent>
      </Card>
    </div>
  );
}
