import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';

const TYPE_LABEL: Record<string, string> = {
  stockout: '缺货',
  below_safety: '低于安全库存',
  below_rop: '低于 ROP',
};

export function AlertsPage() {
  const qc = useQueryClient();
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

  const alerts = data.items;

  return (
    <div className="space-y-6">
      <PageHeader title="缺货预警">
        <Button onClick={() => runAlert.mutate()} disabled={runAlert.isPending}>
          {runAlert.isPending ? '检测中...' : '手动触发检测'}
        </Button>
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
                <th className="p-2 font-normal">当前库存</th>
                <th className="p-2 font-normal">阈值</th>
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
                  <td className="p-2 font-numeric text-primary">{a.currentQty}</td>
                  <td className="p-2 font-numeric">{a.safetyQty}</td>
                  <td className="p-2 text-text-main">{a.isResolved ? '已处理' : '待处理'}</td>
                  <td className="space-x-1 p-2">
                    {!a.isResolved && (
                      <>
                        <Link
                          to={`/pmc/suggestions?sku=${encodeURIComponent(a.skuCode)}`}
                          className="text-primary hover:underline text-xs"
                        >
                          补货建议
                        </Link>
                        <Link
                          to={`/ai/chat?sku=${encodeURIComponent(a.skuCode)}&skuId=${a.skuId}`}
                          className="text-primary hover:underline text-xs"
                        >
                          问 AI
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
                  <td colSpan={7} className="p-4 text-center text-text-hint">
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
