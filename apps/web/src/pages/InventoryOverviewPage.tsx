import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ImportDrawer } from '@/components/import/ImportDrawer';
import { useImportDrawer } from '@/hooks/use-import-drawer';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { InventoryOverviewTable } from '@/components/InventoryOverviewTable';
import { InventoryOverviewRowDrawer } from '@/components/InventoryOverviewRowDrawer';
import {
  getDefaultVisibleColumnIds,
  mergeColumnCatalog,
  TURNOVER_SHEET_COLUMN_COUNT,
  type OverviewColumnDef,
} from '@/lib/inventory-overview-columns';
import {
  getViewColumnIds,
  loadInitialViewState,
  OVERVIEW_VIEW_OPTIONS,
  resolveAppliedColumnIds,
  saveCustomColumnIds,
  saveOverviewViewId,
  type OverviewViewId,
} from '@/lib/inventory-overview-views';
import { orderColumnGroups } from '@/lib/inventory-overview-groups';
import { orderOverviewColumnIds } from '@/lib/inventory-overview-column-order';
import {
  loadOverviewTableDensity,
  saveOverviewTableDensity,
  type OverviewTableDensity,
} from '@/lib/inventory-overview-density';
import { useResizableColumnWidths } from '@/hooks/use-resizable-column-widths';
import { useMemo, useState, useCallback } from 'react';

const DEFAULT_PAGE_SIZE = 20;

const initialView = loadInitialViewState();

export function InventoryOverviewPage() {
  const qc = useQueryClient();

  const [viewId, setViewId] = useState<OverviewViewId>(initialView.viewId);
  const [customColumnIds, setCustomColumnIds] = useState<string[]>(initialView.customColumnIds);
  const [draftColumnIds, setDraftColumnIds] = useState<string[]>([]);
  const [density, setDensity] = useState<OverviewTableDensity>(() => loadOverviewTableDensity());
  const [drawerSkuId, setDrawerSkuId] = useState<string | null>(null);
  const { open: importOpen, openDrawer: openImportDrawer, closeDrawer: closeImportDrawer } = useImportDrawer();
  const [feishuMessage, setFeishuMessage] = useState('');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [columnJumpInput, setColumnJumpInput] = useState('');
  const [columnJumpTarget, setColumnJumpTarget] = useState<string | null>(null);
  const [snapshotDate, setSnapshotDate] = useState('');

  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [lifecycle, setLifecycle] = useState('');
  const [salesCountry, setSalesCountry] = useState('');
  const [merchantCode, setMerchantCode] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [developerName, setDeveloperName] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [columnFilter, setColumnFilter] = useState('');
  const [applied, setApplied] = useState({
    q: '',
    category: '',
    lifecycle: '',
    salesCountry: '',
    merchantCode: '',
    ownerName: '',
    developerName: '',
  });

  const appliedColumnIds = useMemo(
    () => resolveAppliedColumnIds(viewId, customColumnIds),
    [viewId, customColumnIds],
  );

  const apiView = viewId === 'custom' ? undefined : viewId;
  const apiColumns = viewId === 'custom' ? appliedColumnIds : undefined;

  const { data, isLoading } = useQuery({
    queryKey: [
      'inventory-overview',
      applied,
      page,
      pageSize,
      viewId,
      appliedColumnIds,
      snapshotDate,
    ],
    queryFn: () =>
      api.getInventoryOverview({
        q: applied.q || undefined,
        category: applied.category || undefined,
        lifecycle: applied.lifecycle || undefined,
        salesCountry: applied.salesCountry || undefined,
        merchantCode: applied.merchantCode || undefined,
        ownerName: applied.ownerName || undefined,
        developerName: applied.developerName || undefined,
        page,
        pageSize,
        view: apiView,
        columns: apiColumns,
        snapshotDate: snapshotDate || undefined,
      }),
  });

  const { data: snapshotDates } = useQuery({
    queryKey: ['inventory-overview-dates'],
    queryFn: () => api.getInventorySnapshotDates(),
  });

  const snapshotDateOptions = useMemo(() => {
    const items = snapshotDates?.items ?? [];
    if (items.length > 0) return items;
    if (data?.selectedSnapshotDate) {
      return [
        {
          snapshotDate: data.selectedSnapshotDate,
          rowCount: data.total ?? 0,
          syncedAt: '',
        },
      ];
    }
    return [];
  }, [snapshotDates?.items, data?.selectedSnapshotDate, data?.total]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const columnCatalog = useMemo(() => mergeColumnCatalog(data?.columns), [data?.columns]);
  const columnById = useMemo(
    () => new Map(columnCatalog.map((col) => [col.id, col])),
    [columnCatalog],
  );

  const visibleColumns = useMemo(
    () =>
      appliedColumnIds
        .map((id) => columnById.get(id))
        .filter((col): col is OverviewColumnDef => Boolean(col)),
    [appliedColumnIds, columnById],
  );

  const { getWidth, onResizeStart, resetWidths } = useResizableColumnWidths();

  const { data: bitableStatus } = useQuery({
    queryKey: ['bitable-status'],
    queryFn: () => api.getBitableStatus(),
  });
  const feishuConfigured = bitableStatus?.inventory_turnover?.configured ?? false;

  const previewFeishu = useMutation({
    mutationFn: () => api.previewBitableSync('inventory_turnover'),
    onSuccess: (r) => {
      const mismatch =
        typeof r.mismatchCount === 'number' && r.mismatchCount > 0
          ? `；销售占比合计异常 ${r.mismatchCount} 条`
          : '';
      setFeishuMessage(
        `从飞书预览 ${r.rowCount.toLocaleString()} 行${r.hasBlockingIssues ? '（存在阻断问题，请先处理）' : '，可确认同步'}${mismatch}`,
      );
    },
    onError: (err) => {
      setFeishuMessage((err as Error).message);
    },
  });

  const syncFeishu = useMutation({
    mutationFn: () => api.executeBitableSync('inventory_turnover'),
    onSuccess: (r) => {
      const mismatch =
        typeof r.mismatchCount === 'number' && r.mismatchCount > 0
          ? `；销售占比合计异常 ${r.mismatchCount} 条`
          : '';
      setFeishuMessage(
        `从飞书同步完成：写入 ${r.imported.toLocaleString()} 条；批次 ${r.batchStatus ?? '-'}；每日快照：${r.snapshotDate ? `${r.snapshotDate}（${(r.snapshotRowCount ?? 0).toLocaleString()} SKU）` : r.snapshotSkippedReason ?? '未发布'}；错误：${r.errors.slice(0, 3).join('; ') || '无'}${mismatch}`,
      );
      void qc.invalidateQueries({ queryKey: ['inventory-overview'] });
      void qc.invalidateQueries({ queryKey: ['inventory-overview-dates'] });
      void qc.invalidateQueries({ queryKey: ['import-batches', 'inventory'] });
      // 飞书同步会回写 skus 主字段与包装快照，需刷新商品主数据列表
      void qc.invalidateQueries({ queryKey: ['sku-overview'] });
      void qc.invalidateQueries({ queryKey: ['skus'] });
    },
    onError: (err) => setFeishuMessage((err as Error).message),
  });

  const groupedColumns = useMemo(() => {
    const keyword = columnFilter.trim().toLowerCase();
    const groups = new Map<string, OverviewColumnDef[]>();
    for (const col of columnCatalog) {
      if (
        keyword &&
        !col.label.toLowerCase().includes(keyword) &&
        !col.group.toLowerCase().includes(keyword) &&
        !(col.excelCol ?? '').toLowerCase().includes(keyword)
      ) {
        continue;
      }
      const list = groups.get(col.group) ?? [];
      list.push(col);
      groups.set(col.group, list);
    }
    return orderColumnGroups(Array.from(groups.entries())) as Array<[string, OverviewColumnDef[]]>;
  }, [columnFilter, columnCatalog]);

  const applyView = (nextViewId: OverviewViewId) => {
    setViewId(nextViewId);
    saveOverviewViewId(nextViewId);
    if (showColumnPicker) {
      setDraftColumnIds(
        nextViewId === 'custom'
          ? customColumnIds
          : getViewColumnIds(nextViewId),
      );
    }
  };

  const applyCustomColumns = useCallback((ids: string[]) => {
    const ordered = orderOverviewColumnIds(ids.length ? ids : ['SKU']);
    setCustomColumnIds(ordered);
    saveCustomColumnIds(ordered);
    setViewId('custom');
    saveOverviewViewId('custom');
  }, []);

  const openColumnPicker = () => {
    setDraftColumnIds(appliedColumnIds);
    setShowColumnPicker(true);
  };

  const closeColumnPicker = () => {
    setShowColumnPicker(false);
    setDraftColumnIds([]);
  };

  const applyColumnPicker = () => {
    applyCustomColumns(draftColumnIds);
    setShowColumnPicker(false);
    setDraftColumnIds([]);
  };

  const toggleDraftColumn = (columnId: string) => {
    setDraftColumnIds((prev) => {
      const next = prev.includes(columnId)
        ? prev.filter((id) => id !== columnId)
        : [...prev, columnId];
      return next.length ? next : ['SKU'];
    });
  };

  const toggleDraftGroupColumns = (cols: OverviewColumnDef[], select: boolean) => {
    const ids = cols.map((c) => c.id);
    setDraftColumnIds((prev) => {
      if (select) {
        const merged = [...prev];
        for (const id of ids) {
          if (!merged.includes(id)) merged.push(id);
        }
        return merged;
      }
      const next = prev.filter((id) => !ids.includes(id));
      return next.length ? next : ['SKU'];
    });
  };

  const resetDraftColumns = () => {
    setDraftColumnIds(
      viewId === 'custom' ? getDefaultVisibleColumnIds() : getViewColumnIds(viewId),
    );
  };

  const columnPickerDirty = useMemo(() => {
    if (!showColumnPicker || draftColumnIds.length === 0) return false;
    if (draftColumnIds.length !== appliedColumnIds.length) return true;
    return draftColumnIds.some((id, index) => id !== appliedColumnIds[index]);
  }, [showColumnPicker, draftColumnIds, appliedColumnIds]);

  const handleColumnJump = () => {
    const raw = columnJumpInput.trim();
    if (!raw) return;
    const byExcel = columnCatalog.find(
      (col) => col.excelCol?.toLowerCase() === raw.toLowerCase(),
    );
    const byLabel = columnCatalog.find((col) => col.label.includes(raw));
    const target = byExcel ?? byLabel;
    if (target) {
      if (!appliedColumnIds.includes(target.id)) {
        applyCustomColumns([...appliedColumnIds, target.id]);
      }
      setColumnJumpTarget(null);
      requestAnimationFrame(() => setColumnJumpTarget(target.id));
    }
  };

  const exportParams = {
    q: applied.q || undefined,
    category: applied.category || undefined,
    lifecycle: applied.lifecycle || undefined,
    salesCountry: applied.salesCountry || undefined,
    merchantCode: applied.merchantCode || undefined,
    ownerName: applied.ownerName || undefined,
    developerName: applied.developerName || undefined,
    view: apiView,
    columns: apiColumns,
    snapshotDate: snapshotDate || undefined,
  };

  const applyFilters = () => {
    setPage(1);
    setApplied({ q, category, lifecycle, salesCountry, merchantCode, ownerName, developerName });
  };

  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  return (
    <div className="space-y-6">
      <PageHeader title="库存总览">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => api.exportInventoryOverviewCsv(exportParams)}>
            导出当前视图
          </Button>
          <Button
            variant="outline"
            onClick={() => api.exportInventoryOverviewCsv({ ...exportParams, full: true })}
          >
            导出全字段
          </Button>
          <Button variant="outline" onClick={() => api.exportInventoryCsv()}>
            导出分仓 CSV
          </Button>
          <Button
            variant="outline"
            onClick={() => previewFeishu.mutate()}
            disabled={!feishuConfigured || previewFeishu.isPending}
            title={
              feishuConfigured
                ? '预览飞书「SKU周转相关信息」'
                : '未配置 FEISHU_BITABLE_TABLE_INVENTORY / app token'
            }
          >
            {previewFeishu.isPending ? '预览中…' : '从飞书同步预览'}
          </Button>
          <Button
            onClick={() => {
              if (
                !window.confirm(
                  '将从飞书拉取「SKU周转相关信息」（约数千行）并写入库存总览快照，是否继续？',
                )
              ) {
                return;
              }
              syncFeishu.mutate();
            }}
            disabled={!feishuConfigured || syncFeishu.isPending}
          >
            {syncFeishu.isPending ? '同步中…' : '从飞书同步'}
          </Button>
          <Button variant="outline" onClick={openImportDrawer}>
            导入库存
          </Button>
        </div>
      </PageHeader>

      {feishuMessage ? (
        <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-text-sub">
          {feishuMessage}
        </p>
      ) : null}

      {data?.selectedSnapshotDate ? (
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            data.isStale
              ? 'border-amber-300 bg-amber-50 text-amber-800'
              : 'border-border bg-muted/20 text-text-sub'
          }`}
        >
          当前展示库存快照：{data.selectedSnapshotDate}
          {data.isStale ? '（今日尚无成功快照，已回退最近一次成功数据）' : ''}
        </div>
      ) : (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          尚无每日归档快照，当前展示实时库存数据；下一次飞书完整同步成功后开始归档。
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>SKU 库存周转</CardTitle>
          <p className="text-sm text-text-sub">
            字段与飞书「SKU周转相关信息」对齐（{TURNOVER_SHEET_COLUMN_COUNT} 列）。默认「补货日常」视图；
            点击行查看全字段详情；列头右缘可拖动调宽。
          </p>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-text-sub">
              更新日期
              <select
                className="h-9 rounded-md border border-input bg-card px-2 text-sm text-text-main"
                value={snapshotDate || data?.selectedSnapshotDate || ''}
                onChange={(e) => {
                  setSnapshotDate(e.target.value);
                  setPage(1);
                  setDrawerSkuId(null);
                }}
              >
                {(snapshotDateOptions).map((item) => (
                  <option key={item.snapshotDate} value={item.snapshotDate}>
                    {item.snapshotDate} · {item.rowCount.toLocaleString()} SKU
                  </option>
                ))}
              </select>
            </label>
            <select
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              value={viewId}
              onChange={(e) => applyView(e.target.value as OverviewViewId)}
            >
              {OVERVIEW_VIEW_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <Input
              className="h-9 max-w-[140px]"
              placeholder="SKU / 名称"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
            <Button variant="outline" size="sm" onClick={applyFilters}>
              查询
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowAdvancedFilters((v) => !v)}>
              {showAdvancedFilters ? '收起筛选' : '高级筛选'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => (showColumnPicker ? closeColumnPicker() : openColumnPicker())}>
              {showColumnPicker ? '收起字段' : '显示字段'}
            </Button>
            <select
              className="h-9 rounded-md border border-input bg-card px-2 text-sm"
              value={density}
              onChange={(e) => {
                const next = e.target.value as OverviewTableDensity;
                setDensity(next);
                saveOverviewTableDensity(next);
              }}
            >
              <option value="comfortable">标准行高</option>
              <option value="compact">紧凑行高</option>
            </select>
            <span className="text-sm text-text-sub">
              {appliedColumnIds.length} / {columnCatalog.length} 列
            </span>
            <Button variant="ghost" size="sm" onClick={resetWidths}>
              重置列宽
            </Button>
            <Input
              className="h-9 max-w-[100px]"
              placeholder="列名"
              value={columnJumpInput}
              onChange={(e) => setColumnJumpInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleColumnJump()}
            />
            <Button variant="ghost" size="sm" onClick={handleColumnJump}>
              跳转列
            </Button>
          </div>

          {showAdvancedFilters && (
            <div className="mb-4 grid gap-2 rounded-md border border-border bg-muted/20 p-4 md:grid-cols-3 lg:grid-cols-6">
              <Input placeholder="品类" value={category} onChange={(e) => setCategory(e.target.value)} />
              <Input
                placeholder="生命周期（系统计算）"
                value={lifecycle}
                onChange={(e) => setLifecycle(e.target.value)}
              />
              <Input placeholder="销售国家" value={salesCountry} onChange={(e) => setSalesCountry(e.target.value)} />
              <Input placeholder="供应商编码" value={merchantCode} onChange={(e) => setMerchantCode(e.target.value)} />
              <Input placeholder="负责人" value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
              <Input placeholder="开发人员" value={developerName} onChange={(e) => setDeveloperName(e.target.value)} />
            </div>
          )}

          {showColumnPicker && (
            <div className="mb-4 rounded-md border border-border bg-muted/20 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input
                  className="max-w-xs"
                  placeholder="筛选字段名 / 分组"
                  value={columnFilter}
                  onChange={(e) => setColumnFilter(e.target.value)}
                />
                <Button variant="outline" size="sm" onClick={resetDraftColumns}>
                  恢复当前视图默认
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDraftColumnIds(getViewColumnIds('feishu_full'))}
                >
                  飞书全字段
                </Button>
                <span className="text-xs text-text-sub">
                  已选 {draftColumnIds.length} 列
                  {columnPickerDirty ? '（未保存）' : ''}
                </span>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" size="sm" onClick={closeColumnPicker}>
                    取消
                  </Button>
                  <Button size="sm" onClick={applyColumnPicker} disabled={!columnPickerDirty}>
                    应用列配置
                  </Button>
                </div>
              </div>
              <div className="max-h-72 space-y-4 overflow-y-auto pr-1">
                {groupedColumns.map(([group, cols]) => (
                  <div key={group}>
                    <div className="mb-2 flex items-center gap-2">
                      <p className="text-xs font-medium text-text-sub">{group}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => toggleDraftGroupColumns(cols, true)}
                      >
                        选本组
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => toggleDraftGroupColumns(cols, false)}
                      >
                        取消本组
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {cols.map((col) => (
                        <label key={col.id} className="flex items-start gap-2 text-sm text-text-main">
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={draftColumnIds.includes(col.id)}
                            onChange={() => toggleDraftColumn(col.id)}
                          />
                          <span className="leading-snug">
                            {col.excelCol ? `${col.excelCol} · ` : ''}
                            {col.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <InventoryOverviewTable
            items={items}
            visibleColumns={visibleColumns}
            getColumnWidth={getWidth}
            onResizeStart={onResizeStart}
            onRowClick={(item) => setDrawerSkuId(item.skuId)}
            density={density}
            columnJumpTarget={columnJumpTarget}
          />

          <ListPagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
          />
        </CardContent>
      </Card>

      <InventoryOverviewRowDrawer
        skuId={drawerSkuId}
        snapshotDate={data?.selectedSnapshotDate ?? undefined}
        onClose={() => setDrawerSkuId(null)}
      />
      <ImportDrawer
        open={importOpen}
        type="inventory"
        onClose={closeImportDrawer}
        onSuccess={() => {
          void qc.invalidateQueries({ queryKey: ['inventory-overview'] });
          void qc.invalidateQueries({ queryKey: ['sku-overview'] });
          void qc.invalidateQueries({ queryKey: ['skus'] });
        }}
      />
    </div>
  );
}
