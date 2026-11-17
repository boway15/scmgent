import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DataQueryField,
  DataQuerySection,
  DataQuerySubmitButton,
  DataQueryToolbar,
} from '@/components/data-query';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ImportDrawer } from '@/components/import/ImportDrawer';
import { useImportDrawer } from '@/hooks/use-import-drawer';
import { CategorySearchSelect } from '@/components/CategorySearchSelect';
import { cn } from '@/lib/utils';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { useProductScope } from '@/lib/product-scope';
import { SalesHistoryDataTable } from '@/components/SalesHistoryDataTable';
import { useResizableColumnWidths } from '@/hooks/use-resizable-column-widths';
import {
  defaultSalesHistoryDailyColumnWidth,
  defaultSalesHistoryMonthlyColumnWidth,
  loadSalesHistoryDailyColumnWidths,
  loadSalesHistoryMonthlyColumnWidths,
  saveSalesHistoryDailyColumnWidths,
  saveSalesHistoryMonthlyColumnWidths,
  SALES_HISTORY_DAILY_WIDTHS_KEY,
  SALES_HISTORY_MONTHLY_WIDTHS_KEY,
} from '@/lib/sales-history-column-widths';
import { LIST_COLUMN_WIDTH_MAX } from '@/lib/column-width-storage';

const DEFAULT_PAGE_SIZE = 20;
type SalesDimension = 'daily' | 'monthly';

function defaultDailyTo() {
  return new Date().toISOString().slice(0, 10);
}

function defaultDailyFrom() {
  return new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);
}

function defaultMonthlyTo() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function defaultMonthlyFrom() {
  const d = new Date();
  d.setMonth(d.getMonth() - 11);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function SalesHistoryPage() {
  const dailyColumnWidths = useResizableColumnWidths({
    storageKey: SALES_HISTORY_DAILY_WIDTHS_KEY,
    loadWidths: loadSalesHistoryDailyColumnWidths,
    saveWidths: saveSalesHistoryDailyColumnWidths,
    defaultColumnWidth: defaultSalesHistoryDailyColumnWidth,
    maxWidth: LIST_COLUMN_WIDTH_MAX,
    legacyStorageKeys: [
      'scm.sales-history.daily-column-widths-v1',
      'scm.sales-history.daily-column-widths-v2',
    ],
    columnIds: [
      'saleDate',
      'skuCode',
      'skuName',
      'category',
      'qtySold',
      'station',
      'salesRegion',
      'channel',
      'warehouseCode',
      'source',
    ],
  });
  const monthlyColumnWidths = useResizableColumnWidths({
    storageKey: SALES_HISTORY_MONTHLY_WIDTHS_KEY,
    loadWidths: loadSalesHistoryMonthlyColumnWidths,
    saveWidths: saveSalesHistoryMonthlyColumnWidths,
    defaultColumnWidth: defaultSalesHistoryMonthlyColumnWidth,
    maxWidth: LIST_COLUMN_WIDTH_MAX,
    legacyStorageKeys: [
      'scm.sales-history.monthly-column-widths-v1',
      'scm.sales-history.monthly-column-widths-v2',
    ],
    columnIds: ['saleMonth', 'skuCode', 'skuName', 'category', 'qtySold', 'channel', 'source'],
  });
  const { productScope } = useProductScope();
  const qc = useQueryClient();
  const { open: importOpen, openDrawer: openImportDrawer, closeDrawer: closeImportDrawer } = useImportDrawer();
  const [dimension, setDimension] = useState<SalesDimension>('daily');

  const [skuCode, setSkuCode] = useState('');
  const [from, setFrom] = useState(defaultDailyFrom);
  const [to, setTo] = useState(defaultDailyTo);
  const [monthFrom, setMonthFrom] = useState(defaultMonthlyFrom);
  const [monthTo, setMonthTo] = useState(defaultMonthlyTo);
  const [channel, setChannel] = useState('');
  const { data: platforms } = useQuery({
    queryKey: ['sales-history-platforms'],
    queryFn: () => api.getSalesHistoryPlatforms(),
    staleTime: 60_000,
  });
  const [warehouse, setWarehouse] = useState('');
  const [station, setStation] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [applied, setApplied] = useState({
    skuCode: '',
    from: defaultDailyFrom(),
    to: defaultDailyTo(),
    monthFrom: defaultMonthlyFrom(),
    monthTo: defaultMonthlyTo(),
    channel: '',
    warehouse: '',
    station: '',
    category: '',
  });

  const { data: salesImportBatches } = useQuery({
    queryKey: ['import-batches', 'sales'],
    queryFn: () => api.getImportBatches('sales'),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((batch) => batch.status === 'pending') ? 5000 : false,
  });
  const pendingSalesImport = salesImportBatches?.find((batch) => batch.status === 'pending');

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ['sales-history-daily', applied, page, pageSize, productScope],
    queryFn: () =>
      api.getSalesHistory({
        skuCode: applied.skuCode || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        channel: applied.channel || undefined,
        warehouse: applied.warehouse || undefined,
        station: applied.station || undefined,
        category: applied.category || undefined,
        page,
        pageSize,
        productScope,
      }),
    enabled: dimension === 'daily',
  });

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ['sales-history-monthly', applied, page, pageSize, productScope],
    queryFn: () =>
      api.getSalesHistoryMonthly({
        skuCode: applied.skuCode || undefined,
        from: applied.monthFrom || undefined,
        to: applied.monthTo || undefined,
        channel: applied.channel || undefined,
        category: applied.category || undefined,
        page,
        pageSize,
        productScope,
      }),
    enabled: dimension === 'monthly',
  });

  const applyFilters = () => {
    setPage(1);
    setApplied({
      skuCode,
      from,
      to,
      monthFrom,
      monthTo,
      channel,
      warehouse,
      station,
      category,
    });
  };

  const switchDimension = (next: SalesDimension) => {
    setDimension(next);
    setPage(1);
  };

  const handlePageSizeChange = (next: number) => {
    setPageSize(next);
    setPage(1);
  };

  const data = dimension === 'daily' ? dailyData : monthlyData;
  const isLoading = dimension === 'daily' ? dailyLoading : monthlyLoading;

  const exportCsv = () => {
    if (dimension === 'daily') {
      void api.exportSalesHistoryCsv({
        skuCode: applied.skuCode || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        channel: applied.channel || undefined,
        warehouse: applied.warehouse || undefined,
        station: applied.station || undefined,
        category: applied.category || undefined,
        productScope,
      });
      return;
    }
    void api.exportSalesHistoryMonthlyCsv({
      skuCode: applied.skuCode || undefined,
      from: applied.monthFrom || undefined,
      to: applied.monthTo || undefined,
      channel: applied.channel || undefined,
      category: applied.category || undefined,
      productScope,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="销量历史">
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv}>
            导出 CSV
          </Button>
          <Button variant="outline" onClick={openImportDrawer}>
            导入日销量宽表
          </Button>
        </div>
      </PageHeader>

      <ProductScopeSwitch />

      <div className="flex gap-2 border-b border-border">
        <button
          type="button"
          className={cn(
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            dimension === 'daily'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-sub hover:text-text-main',
          )}
          onClick={() => switchDimension('daily')}
        >
          日销量
        </button>
        <button
          type="button"
          className={cn(
            'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
            dimension === 'monthly'
              ? 'border-primary text-primary'
              : 'border-transparent text-text-sub hover:text-text-main',
          )}
          onClick={() => switchDimension('monthly')}
        >
          月销量
        </button>
      </div>

      {dimension === 'monthly' ? (
        <p className="text-sm text-text-sub">
          月销量由日宽表自动聚合，无单独导入入口；查询全历史月份请使用本 Tab。
        </p>
      ) : null}

      <DataQuerySection
        description={
          dimension === 'daily'
            ? '日销量：滚动保留近一年明细，默认近 90 天，用于核对补货算法输入'
            : '月销量：全历史月汇总，用于同比与长周期分析'
        }
      >
        <DataQueryToolbar>
          <DataQueryField label="SKU 编号">
            <Input
              placeholder="SKU"
              className="h-9 w-36 font-mono"
              value={skuCode}
              onChange={(e) => setSkuCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
            />
          </DataQueryField>
          {dimension === 'daily' ? (
            <>
              <DataQueryField label="起始日">
                <Input
                  type="date"
                  className="h-9 w-40"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </DataQueryField>
              <DataQueryField label="截止日">
                <Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
              </DataQueryField>
            </>
          ) : (
            <>
              <DataQueryField label="起始月">
                <Input
                  type="month"
                  className="h-9 w-40"
                  value={monthFrom}
                  onChange={(e) => setMonthFrom(e.target.value)}
                />
              </DataQueryField>
              <DataQueryField label="截止月">
                <Input
                  type="month"
                  className="h-9 w-40"
                  value={monthTo}
                  onChange={(e) => setMonthTo(e.target.value)}
                />
              </DataQueryField>
            </>
          )}
          <DataQueryField label="平台">
            <select
              className="h-9 min-w-28 rounded-md border border-border bg-card px-2 text-sm"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
            >
              <option value="">全部平台</option>
              {(platforms ?? []).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name || item.code}
                </option>
              ))}
            </select>
          </DataQueryField>
          {dimension === 'daily' ? (
            <>
              <DataQueryField label="站点原文">
                <Input
                  placeholder="可选"
                  className="h-9 w-36"
                  value={station}
                  onChange={(e) => setStation(e.target.value)}
                />
              </DataQueryField>
              <DataQueryField label="发货仓">
                <Input
                  placeholder="可选"
                  className="h-9 w-32"
                  value={warehouse}
                  onChange={(e) => setWarehouse(e.target.value)}
                />
              </DataQueryField>
            </>
          ) : null}
          <div className="w-56 shrink-0">
            <DataQueryField label="品类">
              <CategorySearchSelect value={category} onChange={setCategory} />
            </DataQueryField>
          </div>
          <DataQuerySubmitButton onClick={applyFilters} />
        </DataQueryToolbar>
      </DataQuerySection>

      {pendingSalesImport && dimension === 'daily' ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          日销量全量导入进行中：宽表 {pendingSalesImport.rowCount.toLocaleString()} 个 SKU，已写入日销量约{' '}
          {(pendingSalesImport.dailyRowsWritten ?? pendingSalesImport.successCount).toLocaleString()}
          {pendingSalesImport.progressMeta?.estimatedDailyRows
            ? ` / 约 ${pendingSalesImport.progressMeta.estimatedDailyRows.toLocaleString()}`
            : ''}
          。下方「共 X 条」为当前库内合计（含历史数据），导入完成前会持续增加。
        </p>
      ) : null}

      {data && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
          <span className="text-text-sub">
            共{' '}
            <span className="font-numeric font-medium text-text-main">
              {data.summary.rowCount.toLocaleString()}
            </span>{' '}
            条{dimension === 'daily' ? '日' : '月'}销量明细
          </span>
          <span className="hidden h-4 w-px bg-border sm:inline" aria-hidden />
          <span className="text-text-sub">
            销量合计{' '}
            <span className="font-numeric text-base font-semibold text-primary">
              {data.summary.totalQty.toLocaleString()}
            </span>
          </span>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>{dimension === 'daily' ? '日销量明细' : '月销量明细'}</CardTitle>
          <div className="flex flex-wrap items-center gap-2 text-sm text-text-sub">
            <span>
              列头右缘可拖动调宽；
              {dimension === 'daily' ? '日期' : '月份'}与 SKU 列冻结。
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8"
              onClick={() =>
                dimension === 'daily' ? dailyColumnWidths.resetWidths() : monthlyColumnWidths.resetWidths()
              }
            >
              重置列宽
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : dimension === 'daily' ? (
            <SalesHistoryDataTable
              mode="daily"
              items={dailyData?.items ?? []}
              emptyHint="暂无日销量数据，请点击上方「导入销量」"
              getWidth={dailyColumnWidths.getWidth}
              onResizeStart={dailyColumnWidths.onResizeStart}
              layoutKey={dailyColumnWidths.layoutKey}
            />
          ) : (
            <SalesHistoryDataTable
              mode="monthly"
              items={monthlyData?.items ?? []}
              emptyHint="暂无月销量数据，请先完成日销量导入（系统自动聚合月表）"
              getWidth={monthlyColumnWidths.getWidth}
              onResizeStart={monthlyColumnWidths.onResizeStart}
              layoutKey={monthlyColumnWidths.layoutKey}
            />
          )}
          {data && (
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={data.total}
              onPageChange={setPage}
              onPageSizeChange={handlePageSizeChange}
            />
          )}
        </CardContent>
      </Card>

      <ImportDrawer
        open={importOpen}
        type="sales"
        onClose={closeImportDrawer}
        onSuccess={() => {
          void qc.invalidateQueries({ queryKey: ['sales-history-daily'] });
          void qc.invalidateQueries({ queryKey: ['sales-history-monthly'] });
        }}
      />
    </div>
  );
}
