import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
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

function shareSourceLabel(sourceId: string | null): string | null {
  if (!sourceId) return null;
  if (sourceId.includes('avail-share') || sourceId.includes('transit-share') || sourceId.includes('prod-share')) {
    return '占比拆仓';
  }
  if (sourceId.endsWith('#share')) return '仓由占比推定';
  return null;
}

export function InventoryPoolsPage() {
  const [pool, setPool] = useState<'local' | 'in_transit' | 'overseas'>('local');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const qc = useQueryClient();

  useEffect(() => {
    setPage(1);
  }, [pool, appliedKeyword]);

  const lots = useQuery({
    queryKey: ['inventory-pools', pool, page, pageSize, appliedKeyword],
    queryFn: () =>
      api.getSupplyLots({
        pool,
        page,
        pageSize,
        q: appliedKeyword || undefined,
      }),
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
  const total = lots.data?.total ?? 0;
  const dateUnknownCount = lots.data?.dateUnknownCount ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存三池"
        description="本地来自跟单与飞书供应商订单；无可用日不进时间轴"
      >
        <Button onClick={() => sync.mutate()} disabled={sync.isPending}>
          {sync.isPending ? '同步中...' : '从快照/跟单同步'}
        </Button>
      </PageHeader>

      {sync.isSuccess && sync.data && (
        <p className="text-sm text-text-sub">
          已同步 {sync.data.lotCount} 条批次（其中 {sync.data.eligibleCount} 条可进时间轴）。本地无跟单时会投影飞书「供应商订单」。
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {POOL_TABS.map((tab) => (
          <Button
            key={tab.id}
            variant={pool === tab.id ? 'default' : 'outline'}
            onClick={() => {
              setPool(tab.id);
              setPage(1);
            }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {dateUnknownCount > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 text-sm text-amber-900">
            当前池有 {dateUnknownCount} 条批次缺少可用日（available_at），已高亮，不会进入时间轴。
            <Link className="ml-2 text-primary underline" to="/inventory/data-issues">
              去数据问题队列
            </Link>
          </CardContent>
        </Card>
      )}
      {items.some((row) => row.warehouseCode === 'OVERSEAS') && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="pt-4 text-sm text-amber-900">
            当前池有停在 OVERSEAS 的批次，未确认目的仓前不计入某仓确定线。
            <Link className="ml-2 text-primary underline" to="/inventory/unallocated">
              去未定仓供应
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {POOL_TABS.find((t) => t.id === pool)?.label}（{total}）
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="SKU / 名称 / 仓库 / 工厂"
          />
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
                      {pool === 'local'
                        ? '暂无本地批次：当前没有开放跟单，且没有飞书供应商订单（在产）可投影。在途/海外请切换上方标签。'
                        : '暂无批次。可点击「从快照/跟单同步」生成。'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {!lots.isLoading && total > 0 ? (
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
  const shareLabel = shareSourceLabel(row.sourceId);

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
      <td className="py-2 pr-3 font-mono">
        {row.warehouseCode}
        {shareLabel ? (
          <span className="ml-1 text-xs font-sans text-text-hint">{shareLabel}</span>
        ) : null}
      </td>
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
