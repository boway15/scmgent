import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import {
  loadQueryVisibleColumns,
  saveQueryVisibleColumns,
} from '@/lib/inventory-query-columns';

const DEFAULT_PAGE_SIZE = 20;

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function InventoryQueryPage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [salesCountry, setSalesCountry] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [snapshotDate, setSnapshotDate] = useState('');
  const [applied, setApplied] = useState({
    q: '',
    category: '',
    salesCountry: '',
    lifecycle: '',
  });
  const [visibleColumns, setVisibleColumns] = useState<string[] | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [draftColumns, setDraftColumns] = useState<string[]>([]);
  const [columnFilter, setColumnFilter] = useState('');
  const [drawerItem, setDrawerItem] = useState<{
    skuCode: string;
    payload: Record<string, string>;
  } | null>(null);
  const [exporting, setExporting] = useState(false);

  const columnDialogRef = useRef<HTMLDialogElement>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = columnDialogRef.current;
    if (!el) return;
    if (showColumnPicker) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [showColumnPicker]);

  useEffect(() => {
    const el = detailDialogRef.current;
    if (!el) return;
    if (drawerItem) {
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [drawerItem]);

  const datesQuery = useQuery({
    queryKey: ['inventory-query-dates'],
    queryFn: () => api.getInventoryQueryDates(),
  });

  const listQuery = useQuery({
    queryKey: ['inventory-query', applied, page, pageSize, snapshotDate],
    queryFn: () =>
      api.getInventoryQuery({
        q: applied.q || undefined,
        category: applied.category || undefined,
        salesCountry: applied.salesCountry || undefined,
        lifecycle: applied.lifecycle || undefined,
        page,
        pageSize,
        snapshotDate: snapshotDate || undefined,
      }),
  });

  const data = listQuery.data;
  const catalog = data?.columns ?? [];
  const defaultVisible = data?.defaultVisibleColumns?.length
    ? data.defaultVisibleColumns
    : catalog;

  const appliedColumns = useMemo(() => {
    if (visibleColumns?.length) return visibleColumns;
    return loadQueryVisibleColumns(defaultVisible);
  }, [visibleColumns, defaultVisible]);

  const applyFilters = () => {
    setPage(1);
    setApplied({ q, category, salesCountry, lifecycle });
  };

  const openColumnPicker = () => {
    setDraftColumns(appliedColumns);
    setShowColumnPicker(true);
  };

  const applyColumnPicker = () => {
    const next = draftColumns.length ? draftColumns : ['SKU'];
    setVisibleColumns(next);
    saveQueryVisibleColumns(next);
    setShowColumnPicker(false);
  };

  const toggleDraft = (id: string) => {
    setDraftColumns((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return next.length ? next : ['SKU'];
    });
  };

  const filteredCatalog = catalog.filter((col) =>
    !columnFilter.trim()
      ? true
      : col.toLocaleLowerCase().includes(columnFilter.trim().toLocaleLowerCase()),
  );

  const onExport = async () => {
    setExporting(true);
    try {
      const blob = await api.exportInventoryQueryCsv({
        q: applied.q || undefined,
        category: applied.category || undefined,
        salesCountry: applied.salesCountry || undefined,
        lifecycle: applied.lifecycle || undefined,
        snapshotDate: snapshotDate || undefined,
        columns: appliedColumns,
      });
      const date = data?.selectedSnapshotDate ?? 'export';
      downloadBlob(blob, `inventory-query-${date}.csv`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="库存查询">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={openColumnPicker}>
            列设置
          </Button>
          <Button variant="outline" disabled={exporting || !data?.total} onClick={onExport}>
            {exporting ? '导出中…' : '导出 CSV'}
          </Button>
        </div>
      </PageHeader>
      <p className="text-sm text-muted-foreground -mt-2 mb-2">
        飞书分仓明细镜像；每日 07:20 自动同步，可切换历史日期。
      </p>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">筛选</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">快照日期</span>
              <select
                className="flex h-9 w-44 rounded-md border border-input bg-transparent px-3 text-sm"
                value={snapshotDate || data?.selectedSnapshotDate || ''}
                onChange={(e) => {
                  setSnapshotDate(e.target.value);
                  setPage(1);
                }}
              >
                {(datesQuery.data?.items ?? []).map((d) => (
                  <option key={d.snapshotDate} value={d.snapshotDate}>
                    {d.snapshotDate}（{d.rowCount} 行）
                  </option>
                ))}
                {!datesQuery.data?.items?.length ? (
                  <option value="">暂无快照</option>
                ) : null}
              </select>
            </label>
            <Input
              className="w-44"
              placeholder="SKU / 名称"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
            <Input
              className="w-36"
              placeholder="品类"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            />
            <Input
              className="w-36"
              placeholder="销售国家"
              value={salesCountry}
              onChange={(e) => setSalesCountry(e.target.value)}
            />
            <Input
              className="w-36"
              placeholder="生命周期"
              value={lifecycle}
              onChange={(e) => setLifecycle(e.target.value)}
            />
            <Button onClick={applyFilters}>查询</Button>
          </div>
          <div className="text-sm text-muted-foreground">
            {data?.isStale ? (
              <span className="text-amber-700">
                今日尚未成功同步，当前展示 {data.selectedSnapshotDate} 快照
                {data.syncedAt ? `（同步于 ${new Date(data.syncedAt).toLocaleString()}）` : ''}
              </span>
            ) : data?.syncedAt ? (
              <span>
                快照 {data.selectedSnapshotDate}，同步于{' '}
                {new Date(data.syncedAt).toLocaleString()}
              </span>
            ) : (
              <span>尚无库存查询快照，请等待每日 07:20 任务或在系统任务页触发。</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="max-h-[min(70vh,720px)] overflow-x-auto overflow-y-auto overscroll-x-contain">
            <table className="w-max min-w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur">
                <tr>
                  {appliedColumns.map((col) => (
                    <th
                      key={col}
                      className="whitespace-nowrap border-b px-3 py-2 text-left font-medium"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listQuery.isLoading ? (
                  <tr>
                    <td
                      className="px-3 py-6 text-muted-foreground"
                      colSpan={Math.max(appliedColumns.length, 1)}
                    >
                      加载中…
                    </td>
                  </tr>
                ) : !data?.items.length ? (
                  <tr>
                    <td
                      className="px-3 py-6 text-muted-foreground"
                      colSpan={Math.max(appliedColumns.length, 1)}
                    >
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  data.items.map((item) => (
                    <tr
                      key={item.skuCode}
                      className="cursor-pointer border-b hover:bg-muted/40"
                      onClick={() =>
                        setDrawerItem({ skuCode: item.skuCode, payload: item.payload })
                      }
                    >
                      {appliedColumns.map((col) => (
                        <td key={col} className="whitespace-nowrap px-3 py-2">
                          {item.payload[col] ?? (col === 'SKU' ? item.skuCode : '—')}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t p-3">
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={data?.total ?? 0}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </div>
        </CardContent>
      </Card>

      <dialog
        ref={columnDialogRef}
        className="m-0 ml-auto h-full max-h-full w-full max-w-md border-l border-border bg-card p-0 shadow-lg backdrop:bg-black/30"
        onClose={() => setShowColumnPicker(false)}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-semibold">列设置</h2>
            <Button variant="outline" size="sm" onClick={() => setShowColumnPicker(false)}>
              关闭
            </Button>
          </div>
          <div className="space-y-3 overflow-y-auto p-4">
            <Input
              placeholder="筛选列名"
              value={columnFilter}
              onChange={(e) => setColumnFilter(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraftColumns(
                    defaultVisible.length ? [...defaultVisible] : [...catalog],
                  )
                }
              >
                恢复默认（全部）
              </Button>
              <Button size="sm" onClick={applyColumnPicker}>
                应用
              </Button>
            </div>
            <div className="space-y-1 text-sm">
              {filteredCatalog.map((col) => (
                <label key={col} className="flex items-center gap-2 py-0.5">
                  <input
                    type="checkbox"
                    checked={draftColumns.includes(col)}
                    onChange={() => toggleDraft(col)}
                  />
                  <span>{col}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </dialog>

      <dialog
        ref={detailDialogRef}
        className="m-0 ml-auto h-full max-h-full w-full max-w-lg border-l border-border bg-card p-0 shadow-lg backdrop:bg-black/30"
        onClose={() => setDrawerItem(null)}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-semibold">{drawerItem?.skuCode ?? 'SKU 明细'}</h2>
            <Button variant="outline" size="sm" onClick={() => setDrawerItem(null)}>
              关闭
            </Button>
          </div>
          <dl className="space-y-2 overflow-y-auto p-4 text-sm">
            {Object.entries(drawerItem?.payload ?? {}).map(([key, value]) => (
              <div
                key={key}
                className="grid grid-cols-[10rem_1fr] gap-2 border-b border-border/60 py-1"
              >
                <dt className="text-muted-foreground">{key}</dt>
                <dd className="break-all">{value || '—'}</dd>
              </div>
            ))}
          </dl>
        </div>
      </dialog>
    </div>
  );
}
