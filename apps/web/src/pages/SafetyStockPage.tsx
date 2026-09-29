import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, type SafetyStockMethod, type SafetyStockSuggestionView } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { ImportDrawer } from '@/components/import/ImportDrawer';
import { useImportDrawer } from '@/hooks/use-import-drawer';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { useProductScope } from '@/lib/product-scope';

function rowKey(skuId: string, warehouseCode: string) {
  return `${skuId}::${warehouseCode}`;
}

type SafetyStockEdit = {
  safetyStockQty: number;
  reorderPoint: number;
  reorderQty: number;
  safetyStockDays: number;
  safetyStockMethod: SafetyStockMethod;
  serviceLevel: number;
};

const CONFIDENCE_LABEL = {
  high: '高',
  medium: '中',
  low: '低',
} as const;

function formatDeltaDays(deltaDays: number | null): string {
  if (deltaDays == null) return '—';
  if (deltaDays > 0) return `+${deltaDays} 天`;
  return `${deltaDays} 天`;
}

export function SafetyStockPage() {
  const { productScope } = useProductScope();
  const qc = useQueryClient();
  const { open: importOpen, openDrawer: openImportDrawer, closeDrawer: closeImportDrawer } = useImportDrawer();
  const [suggestionServiceLevel, setSuggestionServiceLevel] = useState(0.95);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['safety-stock', page, pageSize, appliedKeyword, productScope],
    queryFn: () =>
      api.getSafetyStock({ page, pageSize, q: appliedKeyword || undefined, productScope }),
  });
  const items = data?.items ?? [];

  const { data: suggestionResp } = useQuery({
    queryKey: ['safety-stock-suggestions', suggestionServiceLevel],
    queryFn: () =>
      api.getSafetyStockSuggestions({
        serviceLevel: suggestionServiceLevel,
        sort: 'deltaDays_desc',
        limit: 500,
      }),
  });

  const suggestionByKey = useMemo(() => {
    const map = new Map<string, SafetyStockSuggestionView>();
    for (const row of suggestionResp?.items ?? []) {
      map.set(rowKey(row.skuId, row.warehouseCode), row);
    }
    return map;
  }, [suggestionResp]);

  const [editing, setEditing] = useState<Record<string, SafetyStockEdit>>({});

  const calc = useMutation({
    mutationFn: ({
      skuId,
      warehouseCode,
      data,
    }: {
      skuId: string;
      warehouseCode: string;
      data: SafetyStockEdit;
    }) =>
      api.calculateSafetyStock(
        skuId,
        {
          safetyStockMethod: data.safetyStockMethod,
          serviceLevel:
            data.safetyStockMethod === 'coverage_days' ? null : data.serviceLevel,
        },
        warehouseCode,
      ),
    onSuccess: (_result, variables) => {
      setEditing((current) => {
        const next = { ...current };
        delete next[rowKey(variables.skuId, variables.warehouseCode)];
        return next;
      });
      void qc.invalidateQueries({ queryKey: ['safety-stock'] });
      void qc.invalidateQueries({ queryKey: ['safety-stock-suggestions'] });
    },
  });

  const save = useMutation({
    mutationFn: ({
      skuId,
      warehouseCode,
      data,
    }: {
      skuId: string;
      warehouseCode: string;
      data: SafetyStockEdit;
    }) =>
      api.updateSafetyStock(
        skuId,
        {
          ...data,
          serviceLevel:
            data.safetyStockMethod === 'coverage_days' ? null : data.serviceLevel,
        },
        warehouseCode,
      ),
    onSuccess: (_result, variables) => {
      setEditing((current) => {
        const next = { ...current };
        delete next[rowKey(variables.skuId, variables.warehouseCode)];
        return next;
      });
      void qc.invalidateQueries({ queryKey: ['safety-stock'] });
      void qc.invalidateQueries({ queryKey: ['safety-stock-suggestions'] });
    },
  });

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="安全库存设置">
        <Button variant="outline" onClick={openImportDrawer}>
          导入库存策略
        </Button>
      </PageHeader>
      <ProductScopeSwitch />
      <Card>
        <CardHeader>
          <CardTitle>安全库存参数</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-sm text-text-sub">
            支持按仓库独立配置；可选择覆盖天数或 Z 值法计算。建议值由 Z 值法推算（默认 95%
            服务水平），采纳并保存前不影响预警与时间轴。
          </p>
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="SKU 编码 / 名称"
          />
          <div className="mb-4 flex items-center gap-2 text-sm">
            <span className="text-text-sub">建议服务水平</span>
            <select
              className="h-8 rounded-md border border-input bg-card px-2"
              value={suggestionServiceLevel}
              onChange={(e) => setSuggestionServiceLevel(Number(e.target.value))}
            >
              <option value={0.9}>90%</option>
              <option value={0.95}>95%</option>
              <option value={0.975}>97.5%</option>
              <option value={0.99}>99%</option>
            </select>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">SKU</th>
                  <th className="p-2 font-normal">仓库</th>
                  <th className="p-2 font-normal">配置天数</th>
                  <th className="p-2 font-normal">安全库存</th>
                  <th className="p-2 font-normal">ROP</th>
                  <th className="p-2 font-normal">EOQ</th>
                  <th className="p-2 font-normal">建议天数</th>
                  <th className="p-2 font-normal">建议件数</th>
                  <th className="p-2 font-normal">偏差</th>
                  <th className="p-2 font-normal">置信度</th>
                  <th className="p-2 font-normal">安全库存方法</th>
                  <th className="p-2 font-normal">服务水平</th>
                  <th className="p-2 font-normal">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const key = rowKey(item.skuId, item.warehouseCode ?? 'ALL');
                  const suggestion = suggestionByKey.get(key);
                  const edit = editing[key] ?? {
                    safetyStockQty: item.safetyStockQty ?? 0,
                    reorderPoint: item.reorderPoint ?? 0,
                    reorderQty: item.reorderQty ?? 0,
                    safetyStockDays: item.safetyStockDays ?? 14,
                    safetyStockMethod: item.safetyStockMethod ?? 'coverage_days',
                    serviceLevel: Number(item.serviceLevel ?? 0.95),
                  };
                  const wh = item.warehouseCode ?? 'ALL';
                  const configuredDays = item.safetyStockDays ?? 14;
                  const deltaPct = suggestion?.deltaPctDays ?? null;
                  const deltaClass =
                    deltaPct != null && deltaPct > 0.5 ? 'text-amber-600' : 'text-text-sub';

                  return (
                    <tr key={key} className="border-b border-border/60">
                      <td className="p-2 font-mono text-text-main">{item.skuCode}</td>
                      <td className="p-2 font-mono text-text-sub">{wh}</td>
                      <td className="p-2 text-text-sub">{configuredDays}</td>
                      <td className="p-2">
                        <Input
                          type="number"
                          className="h-8 w-20"
                          value={edit.safetyStockQty}
                          onChange={(e) =>
                            setEditing({ ...editing, [key]: { ...edit, safetyStockQty: +e.target.value } })
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          className="h-8 w-20"
                          value={edit.reorderPoint}
                          onChange={(e) =>
                            setEditing({ ...editing, [key]: { ...edit, reorderPoint: +e.target.value } })
                          }
                        />
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          className="h-8 w-20"
                          value={edit.reorderQty}
                          onChange={(e) =>
                            setEditing({ ...editing, [key]: { ...edit, reorderQty: +e.target.value } })
                          }
                        />
                      </td>
                      <td className="p-2 text-text-sub">
                        {suggestion?.suggested.safetyStockDays ?? '—'}
                      </td>
                      <td className="p-2 text-text-sub">
                        {suggestion?.suggested.safetyStockQty ?? '—'}
                      </td>
                      <td className={`p-2 ${deltaClass}`} title={suggestion?.suggested.flags.join(', ')}>
                        {formatDeltaDays(suggestion?.deltaDays ?? null)}
                      </td>
                      <td className="p-2 text-text-sub">
                        {suggestion ? CONFIDENCE_LABEL[suggestion.suggested.confidence] : '—'}
                      </td>
                      <td className="p-2">
                        <select
                          className="h-8 min-w-[132px] rounded-md border border-input bg-card px-2 text-sm"
                          value={edit.safetyStockMethod}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              [key]: {
                                ...edit,
                                safetyStockMethod: e.target.value as SafetyStockMethod,
                              },
                            })
                          }
                        >
                          <option value="coverage_days">覆盖天数</option>
                          <option value="z_demand">Z 值（需求波动）</option>
                          <option value="z_demand_leadtime">Z 值（需求+交期）</option>
                        </select>
                      </td>
                      <td className="p-2">
                        <select
                          className="h-8 min-w-[88px] rounded-md border border-input bg-card px-2 text-sm disabled:opacity-50"
                          value={edit.serviceLevel}
                          disabled={edit.safetyStockMethod === 'coverage_days'}
                          onChange={(e) =>
                            setEditing({
                              ...editing,
                              [key]: { ...edit, serviceLevel: Number(e.target.value) },
                            })
                          }
                        >
                          <option value={0.9}>90%</option>
                          <option value={0.95}>95%</option>
                          <option value={0.975}>97.5%</option>
                          <option value={0.99}>99%</option>
                        </select>
                      </td>
                      <td className="space-x-1 p-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => save.mutate({ skuId: item.skuId, warehouseCode: wh, data: edit })}
                          disabled={save.isPending}
                        >
                          保存
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            calc.mutate({ skuId: item.skuId, warehouseCode: wh, data: edit })
                          }
                          disabled={calc.isPending}
                        >
                          计算
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={
                            suggestion?.suggested.safetyStockQty == null ||
                            suggestion.suggested.reorderPoint == null
                          }
                          onClick={() => {
                            const s = suggestion?.suggested;
                            if (!s || s.safetyStockQty == null || s.reorderPoint == null) return;
                            setEditing({
                              ...editing,
                              [key]: {
                                ...edit,
                                safetyStockQty: s.safetyStockQty,
                                reorderPoint: s.reorderPoint,
                                safetyStockDays: s.safetyStockDays ?? edit.safetyStockDays,
                                safetyStockMethod: 'z_demand',
                                serviceLevel: suggestionServiceLevel,
                              },
                            });
                          }}
                        >
                          采纳
                        </Button>
                      </td>
                    </tr>
                  );
                })}
                {!items.length && (
                  <tr>
                    <td colSpan={13} className="p-4 text-center text-text-hint">
                      暂无 SKU，请先创建或导入
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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

      <ImportDrawer
        open={importOpen}
        type="safety_stock"
        onClose={closeImportDrawer}
        onSuccess={() => {
          void qc.invalidateQueries({ queryKey: ['safety-stock'] });
          void qc.invalidateQueries({ queryKey: ['safety-stock-suggestions'] });
        }}
      />
    </div>
  );
}
