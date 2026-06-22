import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';

const STATUS_LABEL: Record<string, string> = {
  draft: '待跟进',
  submitted: '已跟进',
  cancelled: '已取消',
};

export function PurchaseTrackingPage() {
  const qc = useQueryClient();
  const { data: records = [], isLoading } = useQuery({
    queryKey: ['purchase-tracking'],
    queryFn: api.getPurchaseTracking,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'draft' | 'submitted' | 'cancelled' }) =>
      api.updatePurchaseTracking(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-tracking'] }),
  });

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="采购跟单" />
      <Card>
        <CardHeader>
          <CardTitle>跟单列表</CardTitle>
          <p className="text-sm text-text-sub">
            内部履约台账，非正式采购单。数据来自
            {' '}
            <Link to="/pmc/list" className="text-primary hover:underline">计划列表</Link>
            {' '}
            中已确认的计划；请在计划详情点击「确认计划并生成采购跟单」后自动生成。导出计划请使用计划列表/详情的 CSV 导出，人工发送给商家。
          </p>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">跟单单号</th>
                <th className="p-2 font-normal">来源计划</th>
                <th className="p-2 font-normal">商家</th>
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">数量</th>
                <th className="p-2 font-normal">期望交期</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((d) => (
                <tr key={d.id} className="border-b border-border/60">
                  <td className="p-2 font-mono text-text-main">{d.draftNo}</td>
                  <td className="p-2 font-mono">
                    {d.planId ? (
                      <Link to={`/pmc/${d.planId}`} className="text-primary hover:underline">
                        {d.planNo ?? d.planId.slice(0, 8)}
                      </Link>
                    ) : (
                      d.planNo ?? '-'
                    )}
                  </td>
                  <td className="p-2">{d.merchantName ?? d.merchantCode ?? '-'}</td>
                  <td className="p-2">{d.skuCode}</td>
                  <td className="p-2 font-numeric text-primary">{d.qty}</td>
                  <td className="p-2">{d.expectedDate ?? '-'}</td>
                  <td className="p-2">{STATUS_LABEL[d.status] ?? d.status}</td>
                  <td className="space-x-1 p-2">
                    {d.status === 'draft' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateStatus.mutate({ id: d.id, status: 'submitted' })}
                        >
                          标记已跟进
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateStatus.mutate({ id: d.id, status: 'cancelled' })}
                        >
                          取消
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!records.length && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-text-hint">
                    暂无跟单记录，请先在计划列表确认计划
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
