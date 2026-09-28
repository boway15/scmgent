import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { InventoryHealthBadge } from '@/components/InventoryHealthBadge';
import {
  deriveProjectedStockoutDate,
  formatSuggestionExplain,
  isSuggestedOrderOverdue,
} from '@/lib/reorder-suggestion-explain';

type ReorderSuggestionRow = Awaited<
  ReturnType<typeof api.getReorderSuggestions>
>['items'][number];

export function ReorderSuggestionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const skuFromUrl = searchParams.get('sku')?.trim() ?? '';
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState(skuFromUrl);
  const [appliedKeyword, setAppliedKeyword] = useState(skuFromUrl);

  const { data, isLoading } = useQuery({
    queryKey: ['reorder-suggestions', page, pageSize, appliedKeyword],
    queryFn: () =>
      api.getReorderSuggestions({
        q: appliedKeyword || undefined,
        page,
        pageSize,
      }),
  });
  const items = data?.items ?? [];

  const [expandedReason, setExpandedReason] = useState<Record<string, boolean>>({});
  const { data: merchants = [] } = useQuery({ queryKey: ['merchants'], queryFn: api.getMerchants });

  const [merchantOverride, setMerchantOverride] = useState<Record<string, string>>({});

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

  const acceptSuggestion = useMutation({
    mutationFn: ({ id, merchantCode }: { id: string; merchantCode?: string }) =>
      api.updateReorderSuggestion(id, { status: 'accepted', merchantCode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reorder-suggestions'] });
      qc.invalidateQueries({ queryKey: ['pmc-plans'] });
    },
  });

  const ignoreSuggestion = useMutation({
    mutationFn: (id: string) => api.updateReorderSuggestion(id, { status: 'ignored' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reorder-suggestions'] }),
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

      {skuFromUrl && (
        <p className="text-sm text-text-sub">
          筛选 SKU：<span className="font-mono text-text-main">{skuFromUrl}</span>
          {' · '}
          <button type="button" className="text-primary hover:underline" onClick={clearSkuFilter}>
            清除筛选
          </button>
        </p>
      )}

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6 text-sm text-text-sub">
          <p>
            <strong className="text-text-main">补货预测</strong>：基于销量、飞书库存快照（可售+在途+在产−已分配，不含跟单）与供应链提前期计算覆盖天数与健康灯；同一 SKU 多仓缺口合并为一条<strong className="text-text-main">网络</strong>采购建议，避免重复下单。
          </p>
          <p className="mt-1">
            <strong className="text-text-main">补货建议</strong>：预测产出的待办清单，默认按建议下单日排序（逾期优先）；采纳后合并到同商家草稿计划，在
            {' '}
            <Link to="/pmc/list" className="text-primary hover:underline">计划列表</Link>
            {' '}
            确认计划后才会生成采购跟单。
          </p>
          <p className="mt-1 text-text-hint">
            采纳不会立刻改变库存位置；需确认 PMC 计划、维护跟单里程碑或等待下次快照/预测运行后，有效供给才会更新。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>待行动建议</CardTitle>
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">网络</th>
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">商家</th>
                <th className="p-2 font-normal">健康灯</th>
                <th className="p-2 font-normal">建议下单日</th>
                <th className="p-2 font-normal">预计断货日</th>
                <th className="p-2 font-normal">覆盖天数</th>
                <th className="p-2 font-normal">建议数量</th>
                <th className="p-2 font-normal">需求口径</th>
                <th className="p-2 font-normal">口径</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: ReorderSuggestionRow) => {
                const stockoutDate = deriveProjectedStockoutDate(item.coverageDays);
                const orderOverdue =
                  item.status === 'pending' && isSuggestedOrderOverdue(item.suggestedDate);
                return (
                <tr key={item.id} className="border-b border-border/60">
                  <td className="p-2 font-mono text-primary">
                    {item.warehouseCode ?? '网络'}
                    {Array.isArray(item.metrics?.triggerWarehouses) &&
                    (item.metrics.triggerWarehouses as string[]).length > 0 ? (
                      <span className="ml-1 block text-xs font-sans text-text-sub">
                        触发：{(item.metrics.triggerWarehouses as string[]).join('、')}
                      </span>
                    ) : null}
                  </td>
                  <td className="p-2 font-mono text-text-main">
                    {item.skuId ? (
                      <Link
                        to={`/inventory/planning/${item.skuId}`}
                        className="text-primary hover:underline"
                      >
                        {item.skuCode}
                      </Link>
                    ) : (
                      item.skuCode
                    )}
                  </td>
                  <td className="p-2">
                    {item.merchantCode ? (
                      <span className="font-mono">{item.merchantName ?? item.merchantCode}</span>
                    ) : (
                      <Input
                        className="h-8 w-28"
                        placeholder="商家编号"
                        list="suggestion-merchants"
                        value={merchantOverride[item.id] ?? ''}
                        onChange={(e) =>
                          setMerchantOverride({ ...merchantOverride, [item.id]: e.target.value })
                        }
                      />
                    )}
                  </td>
                  <td className="p-2">
                    {item.healthStatus ? (
                      <InventoryHealthBadge health={item.healthStatus} />
                    ) : (
                      '-'
                    )}
                  </td>
                  <td
                    className={`p-2 font-numeric ${orderOverdue ? 'font-medium text-destructive' : 'text-text-main'}`}
                  >
                    {item.suggestedDate}
                    {orderOverdue ? ' · 逾期' : ''}
                  </td>
                  <td className="p-2 font-numeric text-text-main">
                    {stockoutDate ?? '—'}
                  </td>
                  <td className="p-2 font-numeric text-text-main">
                    {item.coverageDays ?? '-'}
                  </td>
                  <td className="p-2 font-numeric text-primary">{item.suggestedQty}</td>
                  <td className="p-2 text-xs text-text-sub">
                    {(item.metrics?.demandSource as string) === 'forecast' ? '销售预测' : '历史销量'}
                  </td>
                  <td className="max-w-md p-2 text-text-sub">
                    <button
                      type="button"
                      className="text-left text-xs text-primary hover:underline"
                      onClick={() =>
                        setExpandedReason((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                      }
                    >
                      {expandedReason[item.id] ? '收起' : '查看口径'}
                    </button>
                    {expandedReason[item.id] && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-text-main">
                        {formatSuggestionExplain(item.metrics, item)}
                      </p>
                    )}
                  </td>
                  <td className="p-2 text-text-main">
                    {item.status}
                    {item.planId && (
                      <>
                        {' · '}
                        <Link to={`/pmc/${item.planId}`} className="text-primary hover:underline">已入计划</Link>
                      </>
                    )}
                  </td>
                  <td className="space-x-1 p-2">
                    {item.status === 'pending' && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            acceptSuggestion.mutate({
                              id: item.id,
                              merchantCode: item.merchantCode ?? merchantOverride[item.id],
                            })
                          }
                          disabled={acceptSuggestion.isPending || (!item.merchantCode && !merchantOverride[item.id])}
                        >
                          采纳并加入计划
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => ignoreSuggestion.mutate(item.id)}>
                          忽略
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              );
              })}
              {!items.length && (
                <tr>
                  <td colSpan={12} className="p-4 text-center text-text-hint">
                    暂无建议，点击上方「运行补货预测」生成
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <datalist id="suggestion-merchants">
            {merchants.map((m) => (
              <option key={m.merchantCode} value={m.merchantCode} />
            ))}
          </datalist>
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
