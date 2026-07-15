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
import { orderOverviewColumnIds } from '@/lib/inventory-overview-column-order';
import {
  loadOverviewTableDensity,
  saveOverviewTableDensity,
  type OverviewTableDensity,
} from '@/lib/inventory-overview-density';
import { useResizableColumnWidths } from '@/hooks/use-resizable-column-widths';
import { useMemo, useState, useCallback } from 'react';

const IN_PRODUCTION_WAREHOUSE = 'IN-PRODUCTION';
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
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [columnJumpInput, setColumnJumpInput] = useState('');
  const [columnJumpTarget, setColumnJumpTarget] = useState<string | null>(null);

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
    queryKey: ['inventory-overview', applied, page, pageSize, viewId, appliedColumnIds],
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
      }),
  });

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
    return Array.from(groups.entries());
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
  };

  const { data: skus = [] } = useQuery({ queryKey: ['skus'], queryFn: api.getSkus });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses'], queryFn: api.getWarehouses });

  const [showForm, setShowForm] = useState(false);
  const [skuForm, setSkuForm] = useState({
    code: '',
    name: '',
    unit: 'pcs',
    category: '',
    leadTimeDays: 30,
    moq: 0,
    unitCost: 0,
    merchantCode: '',
    merchantName: '',
  });
  const [invForm, setInvForm] = useState({
    skuId: '',
    warehouse: 'US-WEST',
    qtyAvailable: 0,
    qtyInTransit: 0,
    recordedDate: new Date().toISOString().slice(0, 10),
  });
  const [productionForm, setProductionForm] = useState({
    skuId: '',
    qtyInProduction: 0,
    recordedDate: new Date().toISOString().slice(0, 10),
  });

  const applyFilters = () => {
    setPage(1);
    setApplied({ q, category, lifecycle, salesCountry, merchantCode, ownerName, developerName });
  };

  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  const createSku = useMutation({
    mutationFn: () => api.createSku(skuForm),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['skus'] });
      qc.invalidateQueries({ queryKey: ['inventory-overview'] });
      setShowForm(false);
    },
  });

  const createInv = useMutation({
    mutationFn: () => api.createInventoryRecord(invForm),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-overview'] }),
  });

  const createProduction = useMutation({
    mutationFn: () =>
      api.createInventoryRecord({
        skuId: productionForm.skuId,
        warehouse: IN_PRODUCTION_WAREHOUSE,
        qtyInProduction: productionForm.qtyInProduction,
        recordedDate: productionForm.recordedDate,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory-overview'] }),
  });

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
          <Button variant="outline" onClick={openImportDrawer}>
            导入库存
          </Button>
          <Button onClick={() => setShowForm(!showForm)}>{showForm ? '取消' : '新建 SKU'}</Button>
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>SKU 库存周转</CardTitle>
          <p className="text-sm text-text-sub">
            字段目录覆盖 Excel A–GR（{TURNOVER_SHEET_COLUMN_COUNT} 列）。默认「补货日常」视图；
            点击行查看全字段详情；列头右缘可拖动调宽。
          </p>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2">
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
              placeholder="列号 GR"
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
              <Input placeholder="生命周期" value={lifecycle} onChange={(e) => setLifecycle(e.target.value)} />
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
                  onClick={() => setDraftColumnIds(getViewColumnIds('excel_full'))}
                >
                  Excel 全字段
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

          {showForm && (
            <div className="mb-4 grid gap-2 rounded-md border border-border bg-muted/20 p-4 md:grid-cols-4 lg:grid-cols-10">
              <Input placeholder="SKU 编号" value={skuForm.code} onChange={(e) => setSkuForm({ ...skuForm, code: e.target.value })} />
              <Input placeholder="名称" value={skuForm.name} onChange={(e) => setSkuForm({ ...skuForm, name: e.target.value })} />
              <Input placeholder="单位" value={skuForm.unit} onChange={(e) => setSkuForm({ ...skuForm, unit: e.target.value })} />
              <Input placeholder="品类" value={skuForm.category} onChange={(e) => setSkuForm({ ...skuForm, category: e.target.value })} />
              <Input placeholder="商家编号" value={skuForm.merchantCode} onChange={(e) => setSkuForm({ ...skuForm, merchantCode: e.target.value })} />
              <Input placeholder="商家名称" value={skuForm.merchantName} onChange={(e) => setSkuForm({ ...skuForm, merchantName: e.target.value })} />
              <Input type="number" placeholder="交期(天)" value={skuForm.leadTimeDays} onChange={(e) => setSkuForm({ ...skuForm, leadTimeDays: +e.target.value })} />
              <Input type="number" placeholder="MOQ" value={skuForm.moq} onChange={(e) => setSkuForm({ ...skuForm, moq: +e.target.value })} />
              <Input type="number" placeholder="单价" value={skuForm.unitCost} onChange={(e) => setSkuForm({ ...skuForm, unitCost: +e.target.value })} />
              <Button variant="outline" onClick={() => createSku.mutate()} disabled={createSku.isPending}>
                保存 SKU
              </Button>
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

      <InventoryOverviewRowDrawer skuId={drawerSkuId} onClose={() => setDrawerSkuId(null)} />
      <ImportDrawer
        open={importOpen}
        type="inventory"
        onClose={closeImportDrawer}
        onSuccess={() => void qc.invalidateQueries({ queryKey: ['inventory-overview'] })}
      />

      <Card>
        <CardHeader>
          <CardTitle>录入分仓库存</CardTitle>
          <p className="text-sm text-text-sub">可售与在途需指定目的仓；在途表示已发出、指向该仓的货物</p>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-6">
          <select
            className="h-10 rounded-md border border-input bg-card px-3 text-sm text-text-main"
            value={invForm.skuId}
            onChange={(e) => setInvForm({ ...invForm, skuId: e.target.value })}
          >
            <option value="">选择 SKU</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>
          <select
            className="h-10 rounded-md border border-input bg-card px-3 text-sm text-text-main"
            value={invForm.warehouse}
            onChange={(e) => setInvForm({ ...invForm, warehouse: e.target.value })}
          >
            {warehouses.map((w) => (
              <option key={w.code} value={w.code}>
                {w.name} ({w.code})
              </option>
            ))}
          </select>
          <Input type="number" placeholder="可售" value={invForm.qtyAvailable} onChange={(e) => setInvForm({ ...invForm, qtyAvailable: +e.target.value })} />
          <Input type="number" placeholder="在途" value={invForm.qtyInTransit} onChange={(e) => setInvForm({ ...invForm, qtyInTransit: +e.target.value })} />
          <Input type="date" value={invForm.recordedDate} onChange={(e) => setInvForm({ ...invForm, recordedDate: e.target.value })} />
          <Button variant="outline" onClick={() => createInv.mutate()} disabled={!invForm.skuId || createInv.isPending}>
            保存
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>录入在产库存</CardTitle>
          <p className="text-sm text-text-sub">在产不指向仓库；货物发出后请录入对应目的仓的在途数量</p>
        </CardHeader>
        <CardContent className="grid gap-2 md:grid-cols-4">
          <select
            className="h-10 rounded-md border border-input bg-card px-3 text-sm text-text-main"
            value={productionForm.skuId}
            onChange={(e) => setProductionForm({ ...productionForm, skuId: e.target.value })}
          >
            <option value="">选择 SKU</option>
            {skus.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} - {s.name}
              </option>
            ))}
          </select>
          <Input
            type="number"
            placeholder="在产数量"
            value={productionForm.qtyInProduction}
            onChange={(e) => setProductionForm({ ...productionForm, qtyInProduction: +e.target.value })}
          />
          <Input type="date" value={productionForm.recordedDate} onChange={(e) => setProductionForm({ ...productionForm, recordedDate: e.target.value })} />
          <Button variant="outline" onClick={() => createProduction.mutate()} disabled={!productionForm.skuId || createProduction.isPending}>
            保存
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
