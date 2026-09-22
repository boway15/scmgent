import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type InventoryDataIssueRow } from '@/lib/api';

const TYPE_LABEL: Record<InventoryDataIssueRow['issueType'], string> = {
  missing_available_at: '可用时间缺失',
  unallocated_warehouse: '未分仓',
  share_sum_mismatch: '占比偏离',
};

const IMPACT_LABEL: Record<string, string> = {
  timeline: '库存时间轴',
  horizon: '7/15/30 预警',
  planning: '分仓规划',
};

const STATUS_LABEL: Record<InventoryDataIssueRow['status'], string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  dismissed: '已忽略',
};

export function InventoryDataIssuesPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState('open');
  const [issueType, setIssueType] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  useEffect(() => {
    setPage(1);
  }, [status, issueType, appliedKeyword]);

  const list = useQuery({
    queryKey: ['inventory-data-issues', status, issueType, page, pageSize, appliedKeyword],
    queryFn: () =>
      api.getInventoryDataIssues({
        status: status === 'open' ? undefined : status,
        type: issueType === 'all' ? undefined : issueType,
        page,
        pageSize,
        q: appliedKeyword || undefined,
      }),
  });
  const total = list.data?.total ?? list.data?.count ?? 0;

  const scan = useMutation({
    mutationFn: api.scanInventoryDataIssues,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-data-issues'] }),
  });

  const update = useMutation({
    mutationFn: (params: { id: string; status: InventoryDataIssueRow['status'] }) =>
      api.updateInventoryDataIssue(params.id, { status: params.status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-data-issues'] }),
  });

  const openByType = list.data?.openByType ?? {
    missing_available_at: 0,
    unallocated_warehouse: 0,
    share_sum_mismatch: 0,
  };
  const openTotal =
    Number(openByType.missing_available_at ?? 0) +
    Number(openByType.unallocated_warehouse ?? 0) +
    Number(openByType.share_sum_mismatch ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader title="数据问题">
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          {scan.isPending ? '扫描中...' : '立即扫描'}
        </Button>
      </PageHeader>

      <p className="text-sm text-text-sub">
        规划跳过的脏数据在这里成工单。不改时间轴公式；处理的是「算不准」而不是「该补多少」。
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">待处理合计</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-text-main">{openTotal}</p>
          </CardContent>
        </Card>
        {(Object.keys(TYPE_LABEL) as Array<InventoryDataIssueRow['issueType']>).map((type) => (
          <Card key={type} className="shadow-card">
            <CardContent className="pt-6">
              <p className="text-sm text-text-sub">{TYPE_LABEL[type]}</p>
              <p className="mt-2 font-mono text-2xl font-semibold text-text-main">
                {Number(openByType[type] ?? 0)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {scan.isSuccess && scan.data && (
        <p className="text-sm text-text-sub">
          本轮检出 {scan.data.detected} 条，新增 {scan.data.inserted}，刷新 {scan.data.refreshed}，自动结案{' '}
          {scan.data.autoResolved}。
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <select
          className="h-9 rounded-md border border-border bg-white px-2 text-sm"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="open">待处理 / 处理中</option>
          <option value="in_progress">处理中</option>
          <option value="resolved">已解决</option>
          <option value="dismissed">已忽略</option>
        </select>
        <select
          className="h-9 rounded-md border border-border bg-white px-2 text-sm"
          value={issueType}
          onChange={(e) => setIssueType(e.target.value)}
        >
          <option value="all">全部类型</option>
          <option value="missing_available_at">可用时间缺失</option>
          <option value="unallocated_warehouse">未分仓</option>
          <option value="share_sum_mismatch">占比偏离</option>
        </select>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>问题清单（{total}）</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="SKU / 仓库 / 示例说明"
          />
          {list.isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-2 pr-3">问题</th>
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">仓库</th>
                  <th className="py-2 pr-3">数量</th>
                  <th className="py-2 pr-3">影响模块</th>
                  <th className="py-2 pr-3">示例</th>
                  <th className="py-2 pr-3">状态</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {(list.data?.items ?? []).map((row) => (
                  <tr key={row.id} className="border-b last:border-0">
                    <td className="py-2 pr-3">{TYPE_LABEL[row.issueType]}</td>
                    <td className="py-2 pr-3">
                      <Link
                        className="text-primary hover:underline"
                        to={`/inventory/planning/${row.skuId}?warehouse=${encodeURIComponent(row.warehouseCode)}`}
                      >
                        {row.skuCode}
                      </Link>
                      {row.issueType === 'unallocated_warehouse' ? (
                        <div className="mt-1">
                          <Link
                            className="text-xs text-primary hover:underline"
                            to={`/inventory/unallocated?skuId=${encodeURIComponent(row.skuId)}`}
                          >
                            去待分配
                          </Link>
                        </div>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 font-mono">{row.warehouseCode}</td>
                    <td className="py-2 pr-3 font-mono">{row.qty}</td>
                    <td className="py-2 pr-3">{IMPACT_LABEL[row.impactModule] ?? row.impactModule}</td>
                    <td className="py-2 pr-3 text-text-sub">{row.example}</td>
                    <td className="py-2 pr-3">{STATUS_LABEL[row.status]}</td>
                    <td className="py-2 pr-3">
                      {row.status === 'open' || row.status === 'in_progress' ? (
                        <div className="flex flex-wrap gap-1">
                          {row.status === 'open' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={update.isPending}
                              onClick={() => update.mutate({ id: row.id, status: 'in_progress' })}
                            >
                              处理中
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={update.isPending}
                            onClick={() => update.mutate({ id: row.id, status: 'resolved' })}
                          >
                            解决
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={update.isPending}
                            onClick={() => update.mutate({ id: row.id, status: 'dismissed' })}
                          >
                            忽略
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!list.data?.items.length && (
                  <tr>
                    <td colSpan={8} className="py-6 text-text-sub">
                      当前筛选下没有数据问题。可点「立即扫描」从三池与占比生成队列。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {!list.isLoading && total > 0 ? (
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
            />
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
