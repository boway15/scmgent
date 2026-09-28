import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';

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
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['alerts', page, pageSize, appliedKeyword, horizonFilter],
    queryFn: () =>
      api.getAlerts({
        page,
        pageSize,
        q: appliedKeyword || undefined,
        horizonDays: horizonFilter,
        resolved: 'open',
      }),
  });

  const runAlert = useMutation({
    mutationFn: api.runStockAlert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const resolve = useMutation({
    mutationFn: (id: string) => api.resolveAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  useEffect(() => {
    setPage(1);
  }, [horizonFilter]);

  if (isLoading || !data) return <p className="text-text-sub">加载中...</p>;

  const alerts = data.items;

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

      <Card>
        <CardHeader>
          <CardTitle>
            预警列表
            {data.openCount > 0 && (
              <span className="ml-2 text-sm font-normal text-text-sub">
                （{data.openCount.toLocaleString()} 条待处理）
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="SKU 编码 / 名称"
          />
          <p className="mb-3 text-xs text-text-hint">
            本地 / 海外仓 / 在途优先取该目的仓供给批次；没有批次时用飞书周转合计（供应商订单、海外仓在库、调拨在途，同一 SKU 各仓相同）。未来需求为采购周期内预测销量，有待处理补货建议时改为建议量。预计缺货优先用预警上的断货日。
          </p>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">仓库</th>
                <th className="p-2 font-normal">类型</th>
                <th className="p-2 font-normal">窗口</th>
                <th className="p-2 font-normal">本地</th>
                <th className="p-2 font-normal">海外仓</th>
                <th className="p-2 font-normal">在途</th>
                <th className="p-2 font-normal">未来需求</th>
                <th className="p-2 font-normal">预计缺货</th>
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
                  <td className="p-2 font-numeric">{a.localQty.toLocaleString()}</td>
                  <td className="p-2 font-numeric">{a.overseasQty.toLocaleString()}</td>
                  <td className="p-2 font-numeric">{a.inTransitQty.toLocaleString()}</td>
                  <td className="p-2 font-numeric text-primary">
                    {a.futureNeedQty == null ? '—' : a.futureNeedQty.toLocaleString()}
                  </td>
                  <td className="p-2 font-mono text-xs">{a.projectedStockoutDate ?? '—'}</td>
                  <td className="space-x-1 p-2 whitespace-nowrap">
                    {!a.isResolved && (
                      <>
                        <Link
                          to={`/inventory/planning/${a.skuId}${a.warehouseCode ? `?warehouse=${encodeURIComponent(a.warehouseCode)}` : ''}`}
                          className="text-xs text-primary hover:underline"
                        >
                          时间轴
                        </Link>
                        <Link
                          to={`/pmc/suggestions?sku=${encodeURIComponent(a.skuCode)}`}
                          className="text-xs text-primary hover:underline"
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
                  <td colSpan={10} className="p-4 text-center text-text-hint">
                    暂无预警
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={data.total}
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
