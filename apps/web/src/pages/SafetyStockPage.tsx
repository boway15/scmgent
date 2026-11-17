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
import { StickyDataTable, type StickyColumnDef } from '@/components/StickyDataTable';
import { useResizableColumnWidths } from '@/hooks/use-resizable-column-widths';
import {
  defaultSafetyStockColumnWidth,
  loadSafetyStockColumnWidths,
  saveSafetyStockColumnWidths,
} from '@/lib/safety-stock-column-widths';

const SAFETY_STOCK_COLUMNS: StickyColumnDef[] = [
  { id: 'skuCode', label: 'SKU' },
  { id: 'warehouse', label: '仓库' },
  { id: 'configuredDays', label: '配置天数', align: 'right' },
  { id: 'safetyStockQty', label: '安全库存' },
  { id: 'reorderPoint', label: 'ROP' },
  { id: 'reorderQty', label: 'EOQ' },
  { id: 'suggestedDays', label: '建议天数', align: 'right' },
  { id: 'suggestedQty', label: '建议件数', align: 'right' },
  { id: 'delta', label: '偏差' },
  { id: 'confidence', label: '置信度' },
  { id: 'method', label: '安全库存方法', flexGrow: true },
  { id: 'serviceLevel', label: '服务水平' },
  { id: 'actions', label: '操作', flexGrow: true },
];

const SAFETY_STOCK_FROZEN = ['skuCode', 'warehouse'];

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
  const columnWidths = useResizableColumnWidths({
    storageKey: 'scm.safety-stock.column-widths-v2',
    loadWidths: loadSafetyStockColumnWidths,
    saveWidths: saveSafetyStockColumnWidths,
    defaultColumnWidth: defaultSafetyStockColumnWidth,
    maxWidth: 360,
    legacyStorageKeys: ['scm.safety-stock.column-widths-v1'],
    columnIds: SAFETY_STOCK_COLUMNS.map((c) => c.id),
  });
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

  const pagePairs = useMemo(
    () =>
      items.map((item) => ({
        skuId: item.skuId,
        warehouseCode: item.warehouseCode || 'ALL',
      })),
    [items],
  );
  const pairsKey = pagePairs.map((p) => `${p.skuId}:${p.warehouseCode}`).join(',');

  const { data: suggestionResp } = useQuery({
    queryKey: ['safety-stock-suggestions', suggestionServiceLevel, pairsKey],
    enabled: pagePairs.length > 0,
    queryFn: () =>
      api.getSafetyStockSuggestions({
        pairs: pagePairs,
        serviceLevel: suggestionServiceLevel,
        sort: 'deltaDays_desc',
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
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>安全库存参数</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-sub">
            <span>列头右缘可拖动调宽；SKU 与仓库列冻结。</span>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => columnWidths.resetWidths()}>
              重置列宽
            </Button>
          </div>
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
          <StickyDataTable
            columns={SAFETY_STOCK_COLUMNS}
            items={items}
            rowKey={(item) => rowKey(item.skuId, item.warehouseCode ?? 'ALL')}
            frozenColumnIds={SAFETY_STOCK_FROZEN}
            getWidth={columnWidths.getWidth}
            onResizeStart={columnWidths.onResizeStart}
            layoutKey={columnWidths.layoutKey}
            emptyLabel="暂无 SKU，请先创建或导入"
            renderCell={(item, columnId) => {
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

              switch (columnId) {
                case 'skuCode':
                  return <span className="font-mono text-primary">{item.skuCode}</span>;
                case 'warehouse':
                  return <span className="font-mono text-text-sub">{wh}</span>;
                case 'configuredDays':
                  return (
                    <span className="font-numeric tabular-nums text-text-sub">{configuredDays}</span>
                  );
                case 'safetyStockQty':
                  return (
                    <Input
                      type="number"
                      className="h-8 w-20"
                      value={edit.safetyStockQty}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          [key]: { ...edit, safetyStockQty: +e.target.value },
                        })
                      }
                    />
                  );
                case 'reorderPoint':
                  return (
                    <Input
                      type="number"
                      className="h-8 w-20"
                      value={edit.reorderPoint}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          [key]: { ...edit, reorderPoint: +e.target.value },
                        })
                      }
                    />
                  );
                case 'reorderQty':
                  return (
                    <Input
                      type="number"
                      className="h-8 w-20"
                      value={edit.reorderQty}
                      onChange={(e) =>
                        setEditing({
                          ...editing,
                          [key]: { ...edit, reorderQty: +e.target.value },
                        })
                      }
                    />
                  );
                case 'suggestedDays':
                  return (
                    <span className="font-numeric tabular-nums text-text-sub">
                      {suggestion?.suggested.safetyStockDays ?? '—'}
                    </span>
                  );
                case 'suggestedQty':
                  return (
                    <span className="font-numeric tabular-nums text-text-sub">
                      {suggestion?.suggested.safetyStockQty ?? '—'}
                    </span>
                  );
                case 'delta':
                  return (
                    <span
                      className={`font-numeric tabular-nums ${deltaClass}`}
                      title={suggestion?.suggested.flags.join(', ')}
                    >
                      {formatDeltaDays(suggestion?.deltaDays ?? null)}
                    </span>
                  );
                case 'confidence':
                  return (
                    <span className="text-text-sub">
                      {suggestion ? CONFIDENCE_LABEL[suggestion.suggested.confidence] : '—'}
                    </span>
                  );
                case 'method':
                  return (
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
                  );
                case 'serviceLevel':
                  return (
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
                  );
                case 'actions':
                  return (
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          save.mutate({ skuId: item.skuId, warehouseCode: wh, data: edit })
                        }
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
                    </div>
                  );
                default:
                  return null;
              }
            }}
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
