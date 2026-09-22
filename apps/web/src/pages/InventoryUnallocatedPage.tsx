import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type UnallocatedSupplyRow } from '@/lib/api';

const POOL_LABEL: Record<UnallocatedSupplyRow['pool'], string> = {
  local: '本地 / 在产',
  in_transit: '在途',
  overseas: '海外',
};

const BLOCKED_DEST = new Set(['OVERSEAS', 'IN-PRODUCTION']);

type DestDraft = { warehouseCode: string; qty: number };

function draftFromLot(lot: UnallocatedSupplyRow): DestDraft[] {
  if (lot.suggestedDestinations.length) return lot.suggestedDestinations;
  return [{ warehouseCode: '', qty: lot.qty }];
}

function AssignEditor({
  lot,
  warehouses,
  pending,
  onSubmit,
}: {
  lot: UnallocatedSupplyRow;
  warehouses: Array<{ code: string; name: string }>;
  pending: boolean;
  onSubmit: (assignments: DestDraft[]) => void;
}) {
  const [rows, setRows] = useState<DestDraft[]>(() => draftFromLot(lot));
  const sum = rows.reduce((total, row) => total + (Number(row.qty) || 0), 0);
  const dests = warehouses.filter((wh) => !BLOCKED_DEST.has(wh.code));
  const valid =
    rows.length > 0 &&
    sum === lot.qty &&
    rows.every((row) => row.warehouseCode && Number(row.qty) > 0 && !BLOCKED_DEST.has(row.warehouseCode));

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={`${lot.id}-${index}`} className="flex flex-wrap items-center gap-2">
          <select
            className="h-8 min-w-[10rem] rounded-md border border-border bg-white px-2 font-mono text-xs"
            value={row.warehouseCode}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, warehouseCode: event.target.value };
              setRows(next);
            }}
          >
            <option value="">选择目的仓</option>
            {dests.map((wh) => (
              <option key={wh.code} value={wh.code}>
                {wh.code} · {wh.name}
              </option>
            ))}
          </select>
          <input
            className="h-8 w-24 rounded-md border border-border bg-white px-2 font-mono text-xs"
            type="number"
            min={1}
            value={row.qty}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, qty: Number(event.target.value) };
              setRows(next);
            }}
          />
          {rows.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRows(rows.filter((_, i) => i !== index))}
            >
              删除
            </Button>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRows([...rows, { warehouseCode: '', qty: Math.max(lot.qty - sum, 1) }])}
        >
          加仓
        </Button>
        {lot.suggestedDestinations.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={() => setRows(draftFromLot(lot))}>
            按占比草案
          </Button>
        ) : null}
        <span className={sum === lot.qty ? 'text-xs text-text-sub' : 'text-xs text-red-600'}>
          已分 {sum} / {lot.qty}
        </span>
        <Button size="sm" disabled={!valid || pending} onClick={() => onSubmit(rows)}>
          {pending ? '确认中...' : '确认落仓'}
        </Button>
      </div>
    </div>
  );
}

export function InventoryUnallocatedPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const skuId = searchParams.get('skuId')?.trim() || undefined;
  const [pool, setPool] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');

  useEffect(() => {
    setPage(1);
  }, [skuId, pool, appliedKeyword]);

  const warehouses = useQuery({
    queryKey: ['warehouses'],
    queryFn: api.getWarehouses,
  });
  const list = useQuery({
    queryKey: ['inventory-unallocated', skuId, pool, page, pageSize, appliedKeyword],
    queryFn: () =>
      api.getUnallocatedSupply({
        skuId,
        pool: pool === 'all' ? undefined : pool,
        page,
        pageSize,
        q: appliedKeyword || undefined,
      }),
  });
  const total = list.data?.total ?? list.data?.count ?? 0;
  const assign = useMutation({
    mutationFn: (params: { id: string; assignments: DestDraft[] }) =>
      api.assignUnallocatedLot(params.id, { assignments: params.assignments }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory-unallocated'] });
      qc.invalidateQueries({ queryKey: ['inventory-pools'] });
      qc.invalidateQueries({ queryKey: ['inventory-planning'] });
      qc.invalidateQueries({ queryKey: ['planning-dashboard'] });
    },
  });

  const items = list.data?.items ?? [];
  const skuCodes = useMemo(
    () => [...new Set(items.map((row) => row.skuCode))],
    [items],
  );

  return (
    <div className="space-y-6">
      <PageHeader title="未定仓供应">
        {skuId ? (
          <Button
            variant="outline"
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('skuId');
              setSearchParams(next);
            }}
          >
            查看全部
          </Button>
        ) : null}
      </PageHeader>

      <p className="text-sm text-text-sub">
        停在 OVERSEAS 的开放批次不能计入某仓确定线。确认目的仓后写入落仓记录，三池同步仍会尊重。有销售占比的 SKU 继续自动拆仓，不会被改回未确认。
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">待确认批次</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-text-main">
              {list.data?.openCount ?? list.data?.count ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">待确认件数</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-text-main">
              {list.data?.openQty ?? 0}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardContent className="pt-6">
            <p className="text-sm text-text-sub">涉及 SKU</p>
            <p className="mt-2 font-mono text-2xl font-semibold text-text-main">{skuCodes.length}</p>
          </CardContent>
        </Card>
      </div>

      {assign.isError ? (
        <p className="text-sm text-red-600">
          {assign.error instanceof Error ? assign.error.message : '确认落仓失败'}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <select
          className="h-9 rounded-md border border-border bg-white px-2 text-sm"
          value={pool}
          onChange={(event) => {
            setPool(event.target.value);
            setPage(1);
          }}
        >
          <option value="all">全部池</option>
          <option value="local">本地 / 在产</option>
          <option value="in_transit">在途</option>
          <option value="overseas">海外</option>
        </select>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle>待分配批次（{total}）</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="SKU / 名称 / 工厂"
          />
          {list.isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  <th className="py-2 pr-3">SKU</th>
                  <th className="py-2 pr-3">池</th>
                  <th className="py-2 pr-3">数量</th>
                  <th className="py-2 pr-3">可用日</th>
                  <th className="py-2 pr-3">来源</th>
                  <th className="py-2 pr-3">确认落仓</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id} className="border-b align-top last:border-0">
                    <td className="py-2 pr-3">
                      <Link
                        className="text-primary hover:underline"
                        to={`/inventory/planning/${row.skuId}?warehouse=OVERSEAS`}
                      >
                        {row.skuCode}
                      </Link>
                      <div className="text-xs text-text-hint">{row.skuName}</div>
                    </td>
                    <td className="py-2 pr-3">{POOL_LABEL[row.pool]}</td>
                    <td className="py-2 pr-3 font-mono">{row.qty}</td>
                    <td className="py-2 pr-3 font-mono">{row.availableAt ?? '未知'}</td>
                    <td className="py-2 pr-3 font-mono text-xs">
                      {row.source}
                      {row.sourceId ? ` · ${row.sourceId}` : ''}
                    </td>
                    <td className="py-2 pr-3">
                      <AssignEditor
                        key={`${row.id}-${row.qty}-${row.suggestedDestinations.map((d) => `${d.warehouseCode}:${d.qty}`).join(',')}`}
                        lot={row}
                        warehouses={warehouses.data ?? []}
                        pending={assign.isPending}
                        onSubmit={(assignments) =>
                          assign.mutate({ id: row.id, assignments })
                        }
                      />
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={6} className="py-6 text-text-sub">
                      当前没有停在 OVERSEAS 的开放批次。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {!list.isLoading && total > 0 ? (
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
