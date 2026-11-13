import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const FALLBACK_REGIONS = ['US', 'CA', 'EU', 'UK', 'MX', 'BR', 'OTHER'] as const;
type MappingTab = 'stations' | 'warehouses';
type ListMode = 'configured' | 'unmapped';

type MappingRow = {
  key: string;
  region: string;
  pending: boolean;
};

function RegionSelect({
  value,
  regions,
  onChange,
  className,
}: {
  value: string;
  regions: string[];
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <select
      className={cn(
        'h-9 min-w-[7.5rem] rounded-md border border-input bg-card px-2 text-sm text-text-main',
        className,
      )}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">选择区域</option>
      {regions.map((region) => (
        <option key={region} value={region}>
          {region}
        </option>
      ))}
    </select>
  );
}

export function RegionMappingPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<MappingTab>('stations');
  const [listMode, setListMode] = useState<ListMode>('configured');
  const [draftKey, setDraftKey] = useState('');
  const [draftRegion, setDraftRegion] = useState('EU');
  const [rowRegion, setRowRegion] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [backfillMessage, setBackfillMessage] = useState('');
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const stations = useQuery({
    queryKey: ['region-mapping', 'stations'],
    queryFn: () => api.getStationRegionMappings(),
  });
  const warehouses = useQuery({
    queryKey: ['region-mapping', 'warehouses'],
    queryFn: () => api.getWarehouseRegionMappings(),
  });
  const skuWhRefStats = useQuery({
    queryKey: ['region-mapping', 'sku-warehouse-refs'],
    queryFn: () => api.getSkuStationWarehouseRefStats(),
    enabled: tab === 'warehouses',
  });

  const regions = (tab === 'stations' ? stations.data?.regions : warehouses.data?.regions) ?? [
    ...FALLBACK_REGIONS,
  ];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['region-mapping'] });
  };

  const saveStation = useMutation({
    mutationFn: api.saveStationRegionMapping,
    onSuccess: () => {
      setError('');
      setDraftKey('');
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const saveWarehouse = useMutation({
    mutationFn: api.saveWarehouseRegionMapping,
    onSuccess: () => {
      setError('');
      setDraftKey('');
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const deleteStation = useMutation({
    mutationFn: api.deleteStationRegionMapping,
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const deleteWarehouse = useMutation({
    mutationFn: api.deleteWarehouseRegionMapping,
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const importStation = useMutation({
    mutationFn: api.importStationRegionMappings,
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const importWarehouse = useMutation({
    mutationFn: api.importWarehouseRegionMappings,
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (err: Error) => setError(err.message),
  });
  const backfillStations = useMutation({
    mutationFn: api.backfillSalesHistoryRegionsFromStations,
    onSuccess: (result) => {
      setError('');
      setBackfillMessage(`已按站点映射补全 ${result.updated} 条历史销量的销售区域。`);
    },
    onError: (err: Error) => setError(err.message),
  });
  const backfillWarehouses = useMutation({
    mutationFn: api.backfillSalesHistoryRegionsFromWarehouses,
    onSuccess: (result) => {
      setError('');
      setBackfillMessage(`已按仓库映射补全 ${result.updated} 条历史销量的销售区域。`);
    },
    onError: (err: Error) => setError(err.message),
  });
  const importSkuWhRefs = useMutation({
    mutationFn: api.importSkuStationWarehouseRefs,
    onSuccess: (result) => {
      setError('');
      setBackfillMessage(
        `已导入参考：唯一仓 ${result.upsertedUnique}、主仓(B) ${result.upsertedDominant}（源行 ${result.sourceRows}）。`,
      );
      qc.invalidateQueries({ queryKey: ['region-mapping', 'sku-warehouse-refs'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const backfillWarehouseFromRefs = useMutation({
    mutationFn: api.backfillSalesHistoryWarehouseFromUniqueRefs,
    onSuccess: (result) => {
      setError('');
      setBackfillMessage(
        `策略 A：补仓 ${result.updated} 条（唯一仓参考 ${result.refRows} 条）。`,
      );
    },
    onError: (err: Error) => setError(err.message),
  });
  const backfillWarehouseDominant = useMutation({
    mutationFn: api.backfillSalesHistoryWarehouseFromDominantRefs,
    onSuccess: (result) => {
      setError('');
      setBackfillMessage(
        `策略 B：补仓 ${result.updated} 条（主仓参考 ${result.refRows} 条；多仓取 CSV 频次最高）。`,
      );
    },
    onError: (err: Error) => setError(err.message),
  });
  const backfillWarehouseBySalesRegion = useMutation({
    mutationFn: api.backfillSalesHistoryWarehouseFromSalesRegionRefs,
    onSuccess: (result) => {
      setError('');
      setBackfillMessage(
        `策略 C：补仓 ${result.updated} 条（站点→销售区域 + 同区域 SKU 仓参考）。`,
      );
    },
    onError: (err: Error) => setError(err.message),
  });

  const busy =
    saveStation.isPending ||
    saveWarehouse.isPending ||
    deleteStation.isPending ||
    deleteWarehouse.isPending ||
    importStation.isPending ||
    importWarehouse.isPending ||
    backfillStations.isPending ||
    backfillWarehouses.isPending ||
    importSkuWhRefs.isPending ||
    backfillWarehouseFromRefs.isPending ||
    backfillWarehouseDominant.isPending ||
    backfillWarehouseBySalesRegion.isPending;

  const activeQuery = tab === 'stations' ? stations : warehouses;
  const configuredCount =
    tab === 'stations' ? (stations.data?.items.length ?? 0) : (warehouses.data?.items.length ?? 0);
  const unmappedCount =
    tab === 'stations'
      ? (stations.data?.unmappedStations.length ?? 0)
      : (warehouses.data?.unmappedWarehouses.length ?? 0);

  const allRows: MappingRow[] = useMemo(() => {
    if (tab === 'stations') {
      const items = stations.data?.items ?? [];
      const unmapped = stations.data?.unmappedStations ?? [];
      if (listMode === 'configured') {
        return items.map((row) => ({
          key: row.station,
          region: row.salesRegion,
          pending: false,
        }));
      }
      return unmapped.map((key) => ({ key, region: '', pending: true }));
    }
    const items = warehouses.data?.items ?? [];
    const unmapped = warehouses.data?.unmappedWarehouses ?? [];
    if (listMode === 'configured') {
      return items.map((row) => ({
        key: row.warehouseCode,
        region: row.fulfillmentRegion,
        pending: false,
      }));
    }
    return unmapped.map((key) => ({ key, region: '', pending: true }));
  }, [tab, listMode, stations.data, warehouses.data]);

  const filteredRows = useMemo(() => {
    const q = appliedKeyword.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((row) => row.key.toLowerCase().includes(q));
  }, [allRows, appliedKeyword]);

  const pageRows = filteredRows.slice((page - 1) * pageSize, page * pageSize);

  const saveNew = () => {
    if (!draftKey.trim() || !draftRegion) {
      setError('请填写名称并选择区域');
      return;
    }
    if (tab === 'stations') {
      saveStation.mutate({ station: draftKey.trim(), salesRegion: draftRegion });
    } else {
      saveWarehouse.mutate({ warehouseCode: draftKey.trim(), fulfillmentRegion: draftRegion });
    }
  };

  const saveRow = (row: MappingRow, region: string) => {
    if (!region) {
      setError('请选择区域');
      return;
    }
    if (tab === 'stations') {
      saveStation.mutate({ station: row.key, salesRegion: region });
    } else {
      saveWarehouse.mutate({ warehouseCode: row.key, fulfillmentRegion: region });
    }
  };

  const rowKey = (row: MappingRow) => `${tab}:${listMode}:${row.key}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="区域映射"
        description={
          tab === 'stations'
            ? '站点→销售区域。入口：系统设置。'
            : `仓库→履约区域；SKU 参考 A:${skuWhRefStats.data?.uniqueCount ?? '…'} / B:${skuWhRefStats.data?.dominantCount ?? '…'} 条。`
        }
      >
        <div className="flex flex-wrap gap-2">
          {tab === 'stations' ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => {
                setBackfillMessage('');
                backfillStations.mutate();
              }}
            >
              {backfillStations.isPending ? '回刷中…' : '回刷空区域（按站点）'}
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBackfillMessage('');
                  backfillWarehouseFromRefs.mutate();
                }}
              >
                {backfillWarehouseFromRefs.isPending ? '补仓中…' : '策略 A：唯一仓'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBackfillMessage('');
                  backfillWarehouseDominant.mutate();
                }}
              >
                {backfillWarehouseDominant.isPending ? '补仓中…' : '策略 B：主仓'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBackfillMessage('');
                  backfillWarehouseBySalesRegion.mutate();
                }}
              >
                {backfillWarehouseBySalesRegion.isPending ? '补仓中…' : '策略 C：同销售区域'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => {
                  setBackfillMessage('');
                  backfillWarehouses.mutate();
                }}
              >
                {backfillWarehouses.isPending ? '回刷中…' : '按仓库补销售区域'}
              </Button>
              <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-primary/30 bg-primary/5 px-3 text-sm text-text-main hover:bg-primary/10">
                {importSkuWhRefs.isPending ? '导入中…' : '导入 SKU 站点仓参考'}
                <input
                  className="hidden"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    setBackfillMessage('');
                    importSkuWhRefs.mutate(file);
                  }}
                />
              </label>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              tab === 'stations'
                ? api.exportStationRegionMappings()
                : api.exportWarehouseRegionMappings()
            }
          >
            导出区域映射 CSV
          </Button>
          {tab === 'stations' || tab === 'warehouses' ? (
            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-input bg-card px-3 text-sm text-text-main hover:bg-muted">
              {importStation.isPending || importWarehouse.isPending ? '导入中…' : '导入区域映射 CSV'}
              <input
                className="hidden"
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  if (tab === 'stations') importStation.mutate(file);
                  else importWarehouse.mutate(file);
                }}
              />
            </label>
          ) : null}
        </div>
      </PageHeader>

      <div className="flex gap-2 border-b border-border">
        {(
          [
            ['stations', '站点映射'],
            ['warehouses', '仓库映射'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-text-sub hover:text-text-main',
            )}
            onClick={() => {
              setTab(id);
              setError('');
              setBackfillMessage('');
              setDraftKey('');
              setPage(1);
              setListMode('configured');
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {backfillMessage ? <p className="text-sm text-text-sub">{backfillMessage}</p> : null}
      {activeQuery.isError ? (
        <p className="text-sm text-destructive">
          {activeQuery.error instanceof Error ? activeQuery.error.message : '加载失败'}
        </p>
      ) : null}

      <Card>
        <CardHeader className="space-y-3 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">
              {tab === 'stations' ? '站点 → 销售区域' : '仓库 → 履约区域'}
            </CardTitle>
            <div className="flex rounded-md border border-border p-0.5 text-sm">
              <button
                type="button"
                className={cn(
                  'rounded px-3 py-1 transition-colors',
                  listMode === 'configured'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-text-sub hover:text-text-main',
                )}
                onClick={() => {
                  setListMode('configured');
                  setPage(1);
                }}
              >
                已配置 ({configuredCount})
              </button>
              <button
                type="button"
                className={cn(
                  'rounded px-3 py-1 transition-colors',
                  listMode === 'unmapped'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-text-sub hover:text-text-main',
                )}
                onClick={() => {
                  setListMode('unmapped');
                  setPage(1);
                }}
              >
                待配置 ({unmappedCount})
              </button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
            <div className="min-w-[200px] flex-1">
              <label className="mb-1 block text-xs text-text-sub">
                {tab === 'stations' ? '站点名称' : '仓库编码'}
              </label>
              <Input
                className="h-9"
                value={draftKey}
                placeholder={tab === 'stations' ? '如 Amazon德国' : '如 HK-FBA美国仓'}
                onChange={(event) => setDraftKey(event.target.value)}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-sub">区域</label>
              <RegionSelect value={draftRegion} regions={regions} onChange={setDraftRegion} />
            </div>
            <Button className="h-9" size="sm" onClick={saveNew} disabled={busy}>
              新增
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
            }}
            placeholder={tab === 'stations' ? '搜索站点…' : '搜索仓库…'}
          />

          {activeQuery.isLoading ? (
            <p className="text-sm text-text-sub">加载中…</p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[640px] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40 text-left text-text-sub">
                      <th className="px-3 py-2 font-normal">
                        {tab === 'stations' ? '站点' : '仓库'}
                      </th>
                      <th className="w-40 px-3 py-2 font-normal">区域</th>
                      <th className="w-36 px-3 py-2 font-normal">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-3 py-8 text-center text-text-sub">
                          {listMode === 'configured' ? '暂无已配置映射' : '暂无待配置项'}
                        </td>
                      </tr>
                    ) : (
                      pageRows.map((row) => {
                        const selected = rowRegion[rowKey(row)] ?? row.region;
                        const dirty = selected !== row.region;
                        return (
                          <tr key={row.key} className="border-b border-border/60">
                            <td className="max-w-md px-3 py-2 text-text-main">
                              <span className="break-all">{row.key}</span>
                              {row.pending ? (
                                <span className="ml-2 inline-flex rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">
                                  待配置
                                </span>
                              ) : null}
                            </td>
                            <td className="px-3 py-2">
                              <RegionSelect
                                value={selected}
                                regions={regions}
                                onChange={(value) =>
                                  setRowRegion((prev) => ({ ...prev, [rowKey(row)]: value }))
                                }
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant={dirty || row.pending ? 'default' : 'outline'}
                                  disabled={busy || (!dirty && !row.pending) || !selected}
                                  onClick={() => saveRow(row, selected)}
                                >
                                  保存
                                </Button>
                                {!row.pending ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() =>
                                      tab === 'stations'
                                        ? deleteStation.mutate(row.key)
                                        : deleteWarehouse.mutate(row.key)
                                    }
                                  >
                                    删除
                                  </Button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <ListPagination
                page={page}
                pageSize={pageSize}
                total={filteredRows.length}
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
