import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { ReorderSuggestionsTable } from '@/components/ReorderSuggestionsTable';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { useProductScope } from '@/lib/product-scope';
import { useResizableColumnWidths } from '@/hooks/use-resizable-column-widths';
import {
  defaultReorderSuggestionsColumnWidth,
  loadReorderSuggestionsColumnWidths,
  saveReorderSuggestionsColumnWidths,
} from '@/lib/reorder-suggestions-column-widths';

export function ReorderSuggestionsPage() {
  const columnWidths = useResizableColumnWidths({
    storageKey: 'scm.reorder-suggestions.column-widths-v2',
    loadWidths: loadReorderSuggestionsColumnWidths,
    saveWidths: saveReorderSuggestionsColumnWidths,
    defaultColumnWidth: defaultReorderSuggestionsColumnWidth,
    maxWidth: 360,
    legacyStorageKeys: ['scm.reorder-suggestions.column-widths-v1'],
    columnIds: [
      'fulfillmentRegion',
      'skuCode',
      'platform',
      'warehouseCode',
      'merchant',
      'healthStatus',
      'suggestedDate',
      'stockoutDate',
      'coverageDays',
      'suggestedQty',
      'demandSource',
      'explain',
      'status',
    ],
  });
  const { productScope } = useProductScope();
  const [searchParams, setSearchParams] = useSearchParams();
  const skuFromUrl = searchParams.get('sku')?.trim() ?? '';
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState(skuFromUrl);
  const [appliedKeyword, setAppliedKeyword] = useState(skuFromUrl);
  const [fulfillmentRegion, setFulfillmentRegion] = useState('');
  const [platform, setPlatform] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: [
      'reorder-suggestions',
      page,
      pageSize,
      appliedKeyword,
      productScope,
      fulfillmentRegion,
      platform,
    ],
    queryFn: () =>
      api.getReorderSuggestions({
        q: appliedKeyword || undefined,
        page,
        pageSize,
        productScope,
        fulfillmentRegion: fulfillmentRegion || undefined,
        platform: platform || undefined,
      }),
  });
  const items = data?.items ?? [];

  useEffect(() => {
    setKeyword(skuFromUrl);
    setAppliedKeyword(skuFromUrl);
    setPage(1);
  }, [skuFromUrl]);

  const runForecast = useMutation({
    mutationFn: api.runReplenishmentForecast,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reorder-suggestions'] });
      qc.invalidateQueries({ queryKey: ['safety-stock'] });
    },
  });

  const clearSkuFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('sku');
    setSearchParams(next, { replace: true });
  };

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="补货建议">
        <Button onClick={() => runForecast.mutate()} disabled={runForecast.isPending}>
          {runForecast.isPending ? '预测计算中...' : '运行补货预测'}
        </Button>
      </PageHeader>

      {skuFromUrl ? (
        <p className="text-sm text-text-sub">
          筛选 SKU：<span className="font-mono text-text-main">{skuFromUrl}</span>
          {' · '}
          <button type="button" className="text-primary hover:underline" onClick={clearSkuFilter}>
            清除筛选
          </button>
        </p>
      ) : null}

      <ProductScopeSwitch />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6 text-sm text-text-sub">
          <p>
            <strong className="text-text-main">补货预测</strong>
            ：按履约区域 × 渠道计算覆盖与健康灯。区域内仓库供给先汇总，再按预测（无预测则历史）渠道占比分摊；未映射仓库落入
            UNMAPPED，仍会出建议。
          </p>
          <p className="mt-1">
            <strong className="text-text-main">补货建议</strong>
            ：预测产出的只读待办清单，默认按建议下单日排序（逾期优先）。实际下单、改量请在迅捷 ERP
            操作；进度以飞书采购镜像为准。
          </p>
          <p className="mt-1 text-text-hint">
            本页不能采纳或忽略建议。导出数量与口径供 PMC 在迅捷下单时参考。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>待行动建议</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-sub">
            <span>列头右缘可拖动调宽；履约区域与 SKU 列冻结。</span>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => columnWidths.resetWidths()}>
              重置列宽
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
              if (skuFromUrl) clearSkuFilter();
            }}
            placeholder="SKU / 商家 / 网络"
          />
          <div className="mb-3 flex flex-wrap gap-2">
            <select
              className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              value={fulfillmentRegion}
              onChange={(event) => {
                setFulfillmentRegion(event.target.value);
                setPage(1);
              }}
            >
              <option value="">全部履约区域</option>
              {['US', 'CA', 'EU', 'UK', 'MX', 'BR', 'OTHER', 'UNMAPPED'].map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
            <input
              className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              placeholder="渠道，如 AMAZON"
              value={platform}
              onChange={(event) => {
                setPlatform(event.target.value.trim().toUpperCase());
                setPage(1);
              }}
            />
          </div>
          <ReorderSuggestionsTable
            items={items}
            getWidth={columnWidths.getWidth}
            onResizeStart={columnWidths.onResizeStart}
            layoutKey={columnWidths.layoutKey}
          />
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
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
