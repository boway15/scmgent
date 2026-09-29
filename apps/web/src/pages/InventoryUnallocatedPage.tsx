import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type UnallocatedSupplyRow } from '@/lib/api';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { useProductScope } from '@/lib/product-scope';

const POOL_LABEL: Record<UnallocatedSupplyRow['pool'], string> = {
  local: '本地 / 在产',
  in_transit: '在途',
  overseas: '海外',
};

function formatSuggestedDestinations(row: UnallocatedSupplyRow): string {
  if (!row.suggestedDestinations.length) {
    return '无销售占比，需在迅捷 / 飞书补目的仓或占比';
  }
  return row.suggestedDestinations
    .map((d) => `${d.warehouseCode} × ${d.qty}`)
    .join('；');
}

export function InventoryUnallocatedPage() {
  const { productScope } = useProductScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const skuId = searchParams.get('skuId')?.trim() || undefined;
  const [pool, setPool] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  useEffect(() => {
    setPage(1);
  }, [skuId, pool, appliedKeyword, productScope]);

  const list = useQuery({
    queryKey: ['inventory-unallocated', skuId, pool, page, pageSize, appliedKeyword, productScope],
    queryFn: () =>
      api.getUnallocatedSupply({
        skuId,
        pool: pool === 'all' ? undefined : pool,
        page,
        pageSize,
        q: appliedKeyword || undefined,
        productScope,
      }),
  });
  const total = list.data?.total ?? list.data?.count ?? 0;

  const items = list.data?.items ?? [];
  const skuCodes = useMemo(
    () => [...new Set(items.map((row) => row.skuCode))],
    [items],
  );

  return (
    <div className="space-y-6">
      <PageHeader title="未定仓供应">
        {skuId ? (
          <Button
            variant="outline"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('skuId');
              setSearchParams(next);
            }}
          >
            查看全部
          </Button>
        ) : null}
      </PageHeader>

      <p className="text-sm text-text-sub">
        停在 OVERSEAS 的批次不能计入某仓确定线。目的仓以迅捷同步到飞书的数据为准（周转快照物理仓列、大件备货「目的仓」）。本页只读；有销售占比时下方展示按占比的参考拆分，不代表已落仓。
      </p>

      <ProductScopeSwitch />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">未定仓批次</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-text-main">
              {list.data?.openCount ?? list.data?.count ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">未定仓件数</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-text-main">
              {list.data?.openQty ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">涉及 SKU</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-text-main">{skuCodes.length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          className="h-9 rounded-md border border-border bg-white px-2 text-sm"
          value={pool}
          onChange={(event) => {
            setPool(event.target.value);
            setPage(1);
          }}
        >
          <option value="all">全部池</option>
          <option value="local">本地 / 在产</option>
          <option value="in_transit">在途</option>
          <option value="overseas">海外</option>
        </select>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>未定仓批次（{total}）</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="SKU / 名称 / 工厂"
          />
          {list.isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">池</th>
                  <th className="py-2 pr-3">数量</th>
                  <th className="py-2 pr-3">可用日</th>
                  <th className="py-2 pr-3">来源</th>
                  <th className="py-2 pr-3">参考拆分（只读）</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      <Link
                        className="text-primary hover:underline"
                        to={`/inventory/planning/${row.skuId}?scope=network`}
                      >
                        {row.skuCode}
                      </Link>
                      <div className="text-xs text-text-hint">{row.skuName}</div>
                    </td>
                    <td className="py-2 pr-3">{POOL_LABEL[row.pool]}</td>
                    <td className="py-2 pr-3 font-mono">{row.qty}</td>
                    <td className="py-2 pr-3 font-mono">{row.availableAt ?? '未知'}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {row.source}
                      {row.sourceId ? ` · ${row.sourceId}` : ''}
                    </td>
                    <td className="py-2 pr-3 text-xs text-text-sub">{formatSuggestedDestinations(row)}</td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={6} className="py-6 text-text-sub">
                      当前没有停在 OVERSEAS 的开放批次。
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
