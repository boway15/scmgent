import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';

const TYPE_LABEL: Record<string, string> = {
  stockout: '缺货',
  below_safety: '低于安全库存',
  below_rop: '低于 ROP',
  stockout_horizon: '未来缺货（确定线）',
  coverage_short: '覆盖不足',
  overstock: '库存积压',
  uncoverable_by_new_po: '新计划已来不及',
};

export function AlertsPage() {
  const qc = useQueryClient();
  const [horizonFilter, setHorizonFilter] = useState<string>('all');
  const { data, isLoading } = useQuery({
    queryKey: ['alerts'],
    queryFn: api.getAlerts,
  });

  const runAlert = useMutation({
    mutationFn: api.runStockAlert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => api.resolveAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  if (isLoading || !data) return <p className="text-text-sub">加载中...</p>;

  const alerts = data.items.filter((a) => {
    if (horizonFilter === 'all') return true;
    if (horizonFilter === 'immediate') return a.horizonDays == null;
    return String(a.horizonDays) === horizonFilter;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="缺货预警">
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-border bg-white px-2 text-sm"
            value={horizonFilter}
            onChange={(e) => setHorizonFilter(e.target.value)}
          >
            <option value="all">全部窗口</option>
            <option value="immediate">即时（无 horizon）</option>
            <option value="7">7 天</option>
            <option value="15">15 天</option>
            <option value="30">30 天</option>
          </select>
          <Button onClick={() => runAlert.mutate()} disabled={runAlert.isPending}>
            {runAlert.isPending ? '检测中...' : '手动触发检测'}
          </Button>
        </div>
      </PageHeader>

      {data.openCount > 0 && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">预警摘要（{data.openCount} 条待处理）</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap text-sm text-text-main">{data.summary}</pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>预警列表</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">仓库</th>
                <th className="p-2 font-normal">类型</th>
                <th className="p-2 font-normal">窗口</th>
                <th className="p-2 font-normal">投影库存</th>
                <th className="p-2 font-normal">阈值</th>
                <th className="p-2 font-normal">预计断货</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} className="border-b border-border/60">
                  <td className="p-2 font-mono text-text-main">{a.skuCode}</td>
                  <td className="p-2 font-mono text-text-sub">{a.warehouseCode ?? '—'}</td>
                  <td className="p-2 text-text-main">{TYPE_LABEL[a.alertType] ?? a.alertType}</td>
                  <td className="p-2 font-mono">{a.horizonDays != null ? `${a.horizonDays}天` : '—'}</td>
                  <td className="p-2 font-numeric text-primary">
                    {a.projectedQty ?? a.currentQty}
                  </td>
                  <td className="p-2 font-numeric">{a.safetyQty}</td>
                  <td className="p-2 font-mono text-xs">{a.projectedStockoutDate ?? '—'}</td>
                  <td className="p-2 text-text-main">{a.isResolved ? '已处理' : '待处理'}</td>
                  <td className="space-x-1 p-2">
                    {!a.isResolved && (
                      <>
                        <Link
                          to={`/inventory/planning/${a.skuId}${a.warehouseCode ? `?warehouse=${encodeURIComponent(a.warehouseCode)}` : ''}`}
                          className="text-primary hover:underline text-xs"
                        >
                          时间轴
                        </Link>
                        <Link
                          to={`/pmc/suggestions?sku=${encodeURIComponent(a.skuCode)}`}
                          className="text-primary hover:underline text-xs"
                        >
                          补货建议
                        </Link>
                        <Button size="sm" variant="outline" onClick={() => resolve.mutate(a.id)}>
                          标记已处理
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!alerts.length && (
                <tr>
                  <td colSpan={9} className="p-4 text-center text-text-hint">
                    暂无预警
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

