import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { InventoryHealthBadge } from '@/components/InventoryHealthBadge';

export function ReorderSuggestionsPage() {
  const [searchParams] = useSearchParams();
  const skuFilter = searchParams.get('sku')?.trim().toLowerCase() ?? '';
  const qc = useQueryClient();
  const { data: allItems = [], isLoading } = useQuery({
    queryKey: ['reorder-suggestions'],
    queryFn: api.getReorderSuggestions,
  });
  const items = skuFilter
    ? allItems.filter((i) => i.skuCode.toLowerCase().includes(skuFilter))
    : allItems;
  const [expandedReason, setExpandedReason] = useState<Record<string, boolean>>({});
  const { data: merchants = [] } = useQuery({ queryKey: ['merchants'], queryFn: api.getMerchants });

  const [merchantOverride, setMerchantOverride] = useState<Record<string, string>>({});

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

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="补货建议">
        <Button onClick={() => runForecast.mutate()} disabled={runForecast.isPending}>
          {runForecast.isPending ? '预测计算中...' : '运行补货预测'}
        </Button>
      </PageHeader>

      {skuFilter && (
        <p className="text-sm text-text-sub">
          筛选 SKU：<span className="font-mono text-text-main">{searchParams.get('sku')}</span>
          {' · '}
          <Link to="/pmc/suggestions" className="text-primary hover:underline">
            清除筛选
          </Link>
        </p>
      )}

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="pt-6 text-sm text-text-sub">
          <p>
            <strong className="text-text-main">补货预测</strong>：基于销量、三类库存（可售+在途+在产）与供应链周期（生产+海运+入仓缓冲）计算覆盖天数与健康灯，生成建议行。
          </p>
          <p className="mt-1">
            <strong className="text-text-main">补货建议</strong>：预测产出的待办清单；采纳后合并到同商家草稿计划，在
            {' '}
            <Link to="/pmc/list" className="text-primary hover:underline">计划列表</Link>
            {' '}
            确认计划后才会生成采购跟单。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>建议列表</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">目标仓</th>
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">商家</th>
                <th className="p-2 font-normal">健康灯</th>
                <th className="p-2 font-normal">覆盖天数</th>
                <th className="p-2 font-normal">建议数量</th>
                <th className="p-2 font-normal">建议日期</th>
                <th className="p-2 font-normal">需求口径</th>
                <th className="p-2 font-normal">原因</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-border/60">
                  <td className="p-2 font-mono text-primary">{item.warehouseCode ?? '-'}</td>
                  <td className="p-2 font-mono text-text-main">{item.skuCode}</td>
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
                  <td className="p-2 font-numeric text-text-main">
                    {item.coverageDays ?? '-'}
                  </td>
                  <td className="p-2 font-numeric text-primary">{item.suggestedQty}</td>
                  <td className="p-2 font-numeric text-text-main">{item.suggestedDate}</td>
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
                      {expandedReason[item.id] ? '收起' : '查看依据'}
                    </button>
                    {expandedReason[item.id] && (
                      <p className="mt-1 whitespace-pre-wrap text-xs text-text-main">{item.reason}</p>
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
              ))}
              {!items.length && (
                <tr>
                  <td colSpan={8} className="p-4 text-center text-text-hint">
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
        </CardContent>
      </Card>
    </div>
  );
}
