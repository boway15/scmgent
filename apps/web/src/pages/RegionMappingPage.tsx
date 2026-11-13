import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

const FALLBACK_REGIONS = ['US', 'CA', 'EU', 'UK', 'OTHER'] as const;
type MappingTab = 'stations' | 'warehouses';

function RegionSelect({
  value,
  regions,
  onChange,
}: {
  value: string;
  regions: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="h-10 rounded-md border border-input bg-card px-3 text-sm text-text-main"
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
  const [draftKey, setDraftKey] = useState('');
  const [draftRegion, setDraftRegion] = useState('EU');
  const [rowRegion, setRowRegion] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [backfillMessage, setBackfillMessage] = useState('');

  const stations = useQuery({
    queryKey: ['region-mapping', 'stations'],
    queryFn: () => api.getStationRegionMappings(),
  });
  const warehouses = useQuery({
    queryKey: ['region-mapping', 'warehouses'],
    queryFn: () => api.getWarehouseRegionMappings(),
  });
  const skuWhRefStats = useQuery({
    queryKey: ['region-mapping', 'sku-warehouse-refs', 'stats'],
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
    onSuccess: (data) => {
      setError('');
      setBackfillMessage(`按站点回刷完成：更新 ${data.updated} 行销售区域。`);
    },
    onError: (err: Error) => setError(err.message),
  });
  const backfillWarehouses = useMutation({
    mutationFn: api.backfillSalesHistoryRegionsFromWarehouses,
    onSuccess: (data) => {
      setError('');
      setBackfillMessage(`按仓库补区域完成：更新 ${data.updated} 行。`);
    },
    onError: (err: Error) => setError(err.message),
  });
  const importSkuWhRefs = useMutation({
    mutationFn: api.importSkuStationWarehouseRefs,
    onSuccess: (data) => {
      setError('');
      setBackfillMessage(
        `参考导入：唯一仓 ${data.uniqueWarehouseGroups ?? 0} 组，写入 ${data.upserted ?? 0} 条。`,
      );
      invalidate();
      qc.invalidateQueries({ queryKey: ['region-mapping', 'sku-warehouse-refs'] });
    },
    onError: (err: Error) => setError(err.message),
  });
  const backfillWarehouseFromRefs = useMutation({
    mutationFn: api.backfillSalesHistoryWarehouseFromUniqueRefs,
    onSuccess: (data) => {
      setError('');
      setBackfillMessage(`策略 A（唯一仓）：补仓 ${data.updated} 行。`);
    },
    onError: (err: Error) => setError(err.message),
  });
  const backfillWarehouseDominant = useMutation({
    mutationFn: api.backfillSalesHistoryWarehouseFromDominantRefs,
    onSuccess: (data) => {
      setError('');
      setBackfillMessage(`策略 B（主仓）：补仓 ${data.updated} 行。`);
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
    backfillWarehouseDominant.isPending;

  const saveNew = () => {
    if (!draftKey.trim() || !draftRegion) {
      setError('请填写键并选择区域');
      return;
    }
    if (tab === 'stations') {
      saveStation.mutate({ station: draftKey.trim(), salesRegion: draftRegion });
    } else {
      saveWarehouse.mutate({ warehouseCode: draftKey.trim(), fulfillmentRegion: draftRegion });
    }
  };

  const stationItems = stations.data?.items ?? [];
  const warehouseItems = warehouses.data?.items ?? [];
  const unmappedStations = stations.data?.unmappedStations ?? [];
  const unmappedWarehouses = warehouses.data?.unmappedWarehouses ?? [];
  const activeQuery = tab === 'stations' ? stations : warehouses;
  const activeLoadError = activeQuery.isError
    ? activeQuery.error instanceof Error
      ? activeQuery.error.message
      : '区域映射加载失败'
    : '';
  const unmappedKeys = tab === 'stations' ? unmappedStations : unmappedWarehouses;

  return (
    <div className="space-y-6">
      <PageHeader
        title="区域映射"
        description={
          tab === 'stations'
            ? '站点→销售区域。空区域的历史销量可用下方按钮按映射回刷。'
            : `仓库→履约区域。SKU 参考 A:${skuWhRefStats.data?.uniqueCount ?? '…'} / B:${skuWhRefStats.data?.dominantCount ?? '…'} 条。`
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
            disabled={busy}
            onClick={() =>
              tab === 'stations'
                ? api.exportStationRegionMappings()
                : api.exportWarehouseRegionMappings()
            }
          >
            下载 CSV
          </Button>
          <label className="inline-flex h-10 cursor-pointer items-center rounded-md border border-input bg-card px-4 text-sm text-text-main hover:bg-muted">
            {importStation.isPending || importWarehouse.isPending ? '导入中...' : '上传 CSV'}
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
        </div>
      </PageHeader>

      <div className="flex gap-2 border-b border-border">
        {(
          [
            ['stations', '站点 → 销售区域'],
            ['warehouses', '仓库 → 履约区域'],
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
              setDraftKey('');
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {backfillMessage ? <p className="text-sm text-text-sub">{backfillMessage}</p> : null}
      {activeLoadError ? <p className="text-sm text-destructive">{activeLoadError}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>{tab === 'stations' ? '新增站点映射' : '新增仓库映射'}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input
            value={draftKey}
            placeholder={tab === 'stations' ? '原文站点，如 Amazon德国' : '仓库编码，如 US-EAST'}
            onChange={(event) => setDraftKey(event.target.value)}
          />
          <RegionSelect value={draftRegion} regions={regions} onChange={setDraftRegion} />
          <Button onClick={saveNew} disabled={busy}>
            保存
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {tab === 'stations' ? '未映射站点' : '未映射仓库'}
            {activeQuery.isSuccess ? `（${unmappedKeys.length}）` : ''}
          </CardTitle>
          <p className="text-sm text-text-sub">
            {tab === 'stations'
              ? '近 90 天有销量、且未配置销售区域的站点。'
              : '活跃仓和近 90 天出现过、且未配置履约区域的仓码。'}
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {activeQuery.isError ? (
            <p className="text-sm text-destructive">未映射清单加载失败，请稍后重试。</p>
          ) : activeQuery.isLoading ? (
            <p className="text-sm text-text-sub">加载中...</p>
          ) : unmappedKeys.length === 0 ? (
            <p className="text-sm text-text-sub">当前没有未映射项。</p>
          ) : (
            unmappedKeys.map((key) => (
              <div key={key} className="flex flex-wrap items-center gap-2">
                <span className="min-w-40 text-sm text-text-main">{key}</span>
                <RegionSelect
                  value={rowRegion[`${tab}:${key}`] ?? ''}
                  regions={regions}
                  onChange={(value) =>
                    setRowRegion((prev) => ({ ...prev, [`${tab}:${key}`]: value }))
                  }
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !rowRegion[`${tab}:${key}`]}
                  onClick={() => {
                    const region = rowRegion[`${tab}:${key}`];
                    if (!region) return;
                    if (tab === 'stations') {
                      saveStation.mutate({ station: key, salesRegion: region });
                    } else {
                      saveWarehouse.mutate({
                        warehouseCode: key,
                        fulfillmentRegion: region,
                      });
                    }
                  }}
                >
                  写入映射
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{tab === 'stations' ? '已配置站点' : '已配置仓库'}</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-text-sub">
                <th className="p-2 font-medium">{tab === 'stations' ? '站点' : '仓库'}</th>
                <th className="p-2 font-medium">区域</th>
                <th className="p-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {tab === 'stations'
                ? stationItems.map((row) => {
                    const selected = rowRegion[`stations:${row.station}`] ?? row.salesRegion;
                    return (
                      <tr key={row.station} className="border-b border-border">
                        <td className="p-2 text-text-main">{row.station}</td>
                        <td className="p-2">
                          <RegionSelect
                            value={selected}
                            regions={regions}
                            onChange={(value) =>
                              setRowRegion((prev) => ({ ...prev, [`stations:${row.station}`]: value }))
                            }
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={busy || selected === row.salesRegion}
                              onClick={() =>
                                saveStation.mutate({ station: row.station, salesRegion: selected })
                              }
                            >
                              保存
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => deleteStation.mutate(row.station)}
                            >
                              删除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                : warehouseItems.map((row) => {
                    const selected = rowRegion[`warehouses:${row.warehouseCode}`] ?? row.fulfillmentRegion;
                    return (
                      <tr key={row.warehouseCode} className="border-b border-border">
                        <td className="p-2 text-text-main">{row.warehouseCode}</td>
                        <td className="p-2">
                          <RegionSelect
                            value={selected}
                            regions={regions}
                            onChange={(value) =>
                              setRowRegion((prev) => ({
                                ...prev,
                                [`warehouses:${row.warehouseCode}`]: value,
                              }))
                            }
                          />
                        </td>
                        <td className="p-2">
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              disabled={busy || selected === row.fulfillmentRegion}
                              onClick={() =>
                                saveWarehouse.mutate({
                                  warehouseCode: row.warehouseCode,
                                  fulfillmentRegion: selected,
                                })
                              }
                            >
                              保存
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => deleteWarehouse.mutate(row.warehouseCode)}
                            >
                              删除
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {(tab === 'stations' ? stations.isLoading : warehouses.isLoading) ? (
            <p className="p-2 text-sm text-text-sub">加载中...</p>
          ) : null}
          {tab === 'stations' && stations.isError ? (
            <p className="p-2 text-sm text-destructive">站点映射加载失败。</p>
          ) : null}
          {tab === 'warehouses' && warehouses.isError ? (
            <p className="p-2 text-sm text-destructive">仓库映射加载失败。</p>
          ) : null}
          {tab === 'stations' && stations.isSuccess && stationItems.length === 0 ? (
            <p className="p-2 text-sm text-text-sub">还没有站点映射。</p>
          ) : null}
          {tab === 'warehouses' && warehouses.isSuccess && warehouseItems.length === 0 ? (
            <p className="p-2 text-sm text-text-sub">还没有仓库映射。</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
