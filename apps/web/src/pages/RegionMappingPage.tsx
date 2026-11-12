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

  const stations = useQuery({
    queryKey: ['region-mapping', 'stations'],
    queryFn: () => api.getStationRegionMappings(),
  });
  const warehouses = useQuery({
    queryKey: ['region-mapping', 'warehouses'],
    queryFn: () => api.getWarehouseRegionMappings(),
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

  const busy =
    saveStation.isPending ||
    saveWarehouse.isPending ||
    deleteStation.isPending ||
    deleteWarehouse.isPending ||
    importStation.isPending ||
    importWarehouse.isPending;

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="区域映射"
        description="站点决定销售区域，仓库决定履约区域。目标只能是 US / CA / EU / UK / OTHER。"
      >
        <div className="flex flex-wrap gap-2">
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
            {tab === 'stations'
              ? `未映射站点（${unmappedStations.length}）`
              : `未映射仓库（${unmappedWarehouses.length}）`}
          </CardTitle>
          <p className="text-sm text-text-sub">近 90 天销量站点，以及活跃仓和近 90 天出现过的仓码。</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {(tab === 'stations' ? unmappedStations : unmappedWarehouses).length === 0 ? (
            <p className="text-sm text-text-sub">当前没有未映射项。</p>
          ) : (
            (tab === 'stations' ? unmappedStations : unmappedWarehouses).map((key) => (
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
          {tab === 'stations' && !stations.isLoading && stationItems.length === 0 ? (
            <p className="p-2 text-sm text-text-sub">还没有站点映射。</p>
          ) : null}
          {tab === 'warehouses' && !warehouses.isLoading && warehouseItems.length === 0 ? (
            <p className="p-2 text-sm text-text-sub">还没有仓库映射。</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
