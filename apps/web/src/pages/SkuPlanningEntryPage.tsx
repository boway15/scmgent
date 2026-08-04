import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ReplenishLightBadge } from '@/components/ReplenishLightBadge';

const DEFAULT_PAGE_SIZE = 20;

export function SkuPlanningEntryPage() {
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const { data, isLoading } = useQuery({
    queryKey: ['sku-planning-entry', appliedQ, page, pageSize],
    queryFn: () =>
      api.getInventoryOverview({
        q: appliedQ || undefined,
        page,
        pageSize,
        view: 'replenish',
      }),
  });

  const applySearch = () => {
    setPage(1);
    setAppliedQ(q.trim());
  };

  return (
    <div className="space-y-4">
      <PageHeader title="SKU 库存规划" />
      <p className="-mt-4 mb-2 text-sm text-muted-foreground">
        搜索 SKU，进入单仓库存位置、提前期与补货指标详情。
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">选择 SKU</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-sm"
              placeholder="SKU 编码 / 名称"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applySearch();
              }}
            />
            <Button onClick={applySearch}>搜索</Button>
          </div>

          {isLoading ? (
            <p className="text-sm text-text-sub">加载中...</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-text-sub">
                      <th className="p-2 font-normal">SKU</th>
                      <th className="p-2 font-normal">名称</th>
                      <th className="p-2 font-normal">品类</th>
                      <th className="p-2 font-normal">销售国家</th>
                      <th className="p-2 font-normal">补货灯</th>
                      <th className="p-2 font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.items ?? []).map((item) => (
                      <tr key={item.skuId} className="border-b border-border/60">
                        <td className="p-2 font-mono text-text-main">{item.code}</td>
                        <td className="p-2 text-text-main">{item.name}</td>
                        <td className="p-2 text-text-sub">{item.category ?? '—'}</td>
                        <td className="p-2 text-text-sub">{item.salesCountry ?? '—'}</td>
                        <td className="p-2">
                          <ReplenishLightBadge light={item.replenishLight ?? 'red'} />
                        </td>
                        <td className="p-2">
                          <Link
                            to={`/inventory/planning/${item.skuId}`}
                            className="text-primary hover:underline"
                          >
                            进入规划
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!data?.items.length ? (
                <p className="text-sm text-text-sub">暂无匹配 SKU，请调整搜索条件。</p>
              ) : null}

              <ListPagination
                page={page}
                pageSize={pageSize}
                total={data?.total ?? 0}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
