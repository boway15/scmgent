import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type SupplyLotRow } from '@/lib/api';

const POOL_TABS = [
  { id: 'local' as const, label: '本地库存' },
  { id: 'in_transit' as const, label: '在途库存' },
  { id: 'overseas' as const, label: '海外库存' },
];

const PROD_LABEL: Record<string, string> = {
  in_production: '生产中',
  qc_pending: '待质检',
  completed: '已完成',
};

export function InventoryPoolsPage() {
  const [pool, setPool] = useState<'local' | 'in_transit' | 'overseas'>('local');
  const qc = useQueryClient();

  const lots = useQuery({
    queryKey: ['inventory-pools', pool],
    queryFn: () => api.getSupplyLots({ pool }),
  });

  const sync = useMutation({
    mutationFn: api.syncSupplyLots,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-pools'] }),
  });

  const updateLot = useMutation({
    mutationFn: (params: {
      id: string;
      productionStatus?: 'in_production' | 'qc_pending' | 'completed';
      shipReadyAt?: string | null;
      latestShipDate?: string | null;
    }) => api.updateSupplyLot(params.id, params),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-pools'] }),
  });

  const items = lots.data?.items ?? [];
  const dateUnknownCount = useMemo(
    () => items.filter((row) => row.dateUnknown || !row.availableAt).length,
    [items],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存三池"
        description="无可用日不进时间轴；估期在途进计划线、不进确定线"
      >
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? '同步中...' : '从快照/跟单同步'}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {POOL_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={pool === tab.id ? 'default' : 'outline'}
            onClick={() => setPool(tab.id)}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {dateUnknownCount > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 text-sm text-amber-900">
            当前池有 {dateUnknownCount} 条批次缺少可用日（available_at），已高亮，不会进入时间轴。
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {POOL_TABS.find((t) => t.id === pool)?.label}（{items.length}）
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {lots.isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">目的仓</th>
                  <th className="py-2 pr-3">数量</th>
                  {pool === 'local' && <th className="py-2 pr-3">生产状态</th>}
                  {pool === 'local' && <th className="py-2 pr-3">可出货日</th>}
                  <th className="py-2 pr-3">预计可售日</th>
                  <th className="py-2 pr-3">来源</th>
                  <th className="py-2 pr-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <LotRow
                    key={row.id}
                    row={row}
                    pool={pool}
                    onSave={(patch) => updateLot.mutate({ id: row.id, ...patch })}
                    saving={updateLot.isPending}
                  />
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={8} className="py-6 text-text-sub">
                      暂无批次。可点击「从快照/跟单同步」生成。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LotRow({
  row,
  pool,
  onSave,
  saving,
}: {
  row: SupplyLotRow;
  pool: 'local' | 'in_transit' | 'overseas';
  onSave: (patch: {
    productionStatus?: 'in_production' | 'qc_pending' | 'completed';
    shipReadyAt?: string | null;
    latestShipDate?: string | null;
  }) => void;
  saving: boolean;
}) {
  const [shipReadyAt, setShipReadyAt] = useState(row.shipReadyAt ?? '');
  const [productionStatus, setProductionStatus] = useState(
    row.productionStatus ?? 'completed',
  );
  const unknown = row.dateUnknown || !row.availableAt;

  return (
    <tr className={unknown ? 'bg-amber-50/80' : undefined}>
      <td className="py-2 pr-3">
        <Link
          className="font-mono text-primary hover:underline"
          to={`/inventory/planning/${row.skuId}?warehouse=${encodeURIComponent(row.warehouseCode)}`}
        >
          {row.skuCode}
        </Link>
        <div className="text-xs text-text-hint">{row.skuName}</div>
      </td>
      <td className="py-2 pr-3 font-mono">{row.warehouseCode}</td>
      <td className="py-2 pr-3 font-mono">{row.qty}</td>
      {pool === 'local' && (
        <td className="py-2 pr-3">
          <select
            className="h-8 rounded border border-border bg-white px-2 text-xs"
            value={productionStatus}
            onChange={(e) =>
              setProductionStatus(e.target.value as typeof productionStatus)
            }
          >
            {Object.entries(PROD_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </td>
      )}
      {pool === 'local' && (
        <td className="py-2 pr-3">
          <input
            type="date"
            className="h-8 rounded border border-border px-2 font-mono text-xs"
            value={shipReadyAt}
            onChange={(e) => setShipReadyAt(e.target.value)}
          />
        </td>
      )}
      <td className="py-2 pr-3 font-mono">
        {row.availableAt ?? (
          <span className="text-amber-700">不可计入可售</span>
        )}
        {row.etaEstimated ? (
          <span className="ml-1 text-xs text-text-hint">(估)</span>
        ) : null}
      </td>
      <td className="py-2 pr-3 text-xs text-text-sub">{row.source}</td>
      <td className="py-2 pr-3">
        {pool === 'local' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() =>
              onSave({
                productionStatus,
                shipReadyAt: shipReadyAt || null,
              })
            }
          >
            保存
          </Button>
        ) : (
          <Link
            className="text-xs text-primary hover:underline"
            to={`/inventory/planning/${row.skuId}?warehouse=${encodeURIComponent(row.warehouseCode)}`}
          >
            时间轴
          </Link>
        )}
      </td>
    </tr>
  );
}
