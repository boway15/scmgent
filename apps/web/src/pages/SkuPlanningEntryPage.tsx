import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import {
  InventoryHealthBadge,
  type InventoryHealth,
} from '@/components/InventoryHealthBadge';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { useProductScope } from '@/lib/product-scope';
import { cn } from '@/lib/utils';

const DEFAULT_PAGE_SIZE = 20;

const HEALTH_FILTER_CHIPS: { v: InventoryHealth; l: string }[] = [
  { v: 'blue', l: '蓝（超备）' },
  { v: 'green', l: '绿（健康）' },
  { v: 'yellow', l: '黄（风险）' },
  { v: 'red', l: '红（高风险）' },
  { v: 'gray', l: '灰（暂停）' },
];

export function SkuPlanningEntryPage() {
  const { productScope } = useProductScope();
  const [q, setQ] = useState('');
  const [appliedQ, setAppliedQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [selectedHealth, setSelectedHealth] = useState<InventoryHealth[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: [
      'sku-planning-entry',
      appliedQ,
      page,
      pageSize,
      productScope,
      selectedHealth,
    ],
    queryFn: () =>
      api.getInventoryOverview({
        q: appliedQ || undefined,
        page,
        pageSize,
        view: 'replenish',
        productScope,
        healthStatuses: selectedHealth.length ? selectedHealth : undefined,
      }),
  });

  const applySearch = () => {
    setPage(1);
    setAppliedQ(q.trim());
  };

  const toggleHealthFilter = (v: InventoryHealth) => {
    setPage(1);
    setSelectedHealth((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader title="SKU 库存规划" />
      <p className="-mt-4 mb-2 text-sm text-muted-foreground">
        搜索 SKU，进入单仓库存位置、提前期与补货指标详情。
      </p>

      <ProductScopeSwitch />

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

          <div className="flex flex-wrap gap-2">
            {HEALTH_FILTER_CHIPS.map(({ v, l }) => {
              const active = selectedHealth.includes(v);
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggleHealthFilter(v)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-sm transition-colors',
                    active
                      ? 'border-primary bg-primary/10 text-text-main'
                      : 'border-border bg-white text-text-sub hover:bg-muted/40',
                  )}
                >
                  {l}
                </button>
              );
            })}
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
                      <th className="p-2 font-normal">健康灯</th>
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
                          {item.healthStatus ? (
                            <InventoryHealthBadge health={item.healthStatus} />
                          ) : (
                            <span className="text-text-hint">未评估</span>
                          )}
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
