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

const DEFAULT_PAGE_SIZE = 20;
type SalesDimension = 'daily' | 'monthly';

const salesTableWrap =
  'max-h-[min(70vh,720px)] overflow-auto rounded-md border border-border bg-card';
const salesTh =
  'sticky top-0 z-10 whitespace-nowrap border-b border-border bg-muted p-2.5 text-left text-xs font-medium text-text-sub';
const salesTd = 'border-b border-border/50 p-2.5 align-top text-sm';
const salesTr = 'group hover:bg-muted/30';

function formatSourceLabel(source: string | null | undefined) {
  const raw = source?.trim() ?? '';
  if (!raw) return '—';
  const lower = raw.toLowerCase();
  if (lower === 'import') return '导入';
  if (lower.includes('feishu') || lower === '飞书') return '飞书';
  return raw;
}

function RegionBadge({ code }: { code?: string | null }) {
  const value = code?.trim();
  if (!value) return <span className="text-text-hint">—</span>;
  return (
    <span className="inline-flex min-w-[2.25rem] justify-center rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-medium text-primary">
      {value}
    </span>
  );
}

function CellText({
  value,
  className,
  clamp = 1,
}: {
  value: string;
  className?: string;
  clamp?: 1 | 2;
}) {
  return (
    <td className={cn(salesTd, className)} title={value}>
      <span
        className={cn(
          'block text-text-main',
          clamp === 2 ? 'line-clamp-2 leading-snug' : 'truncate',
        )}
      >
        {value}
      </span>
    </td>
  );
}

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
        <CardHeader>
          <CardTitle>{dimension === 'daily' ? '日销量明细' : '月销量明细'}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : dimension === 'daily' ? (
            <div className={salesTableWrap}>
              <table className="w-full min-w-[1180px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={cn(salesTh, 'left-0 z-20 min-w-[6.5rem] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]')}>
                      日期
                    </th>
                    <th className={cn(salesTh, 'sticky left-[6.5rem] z-20 min-w-[7.5rem] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)]')}>
                      SKU
                    </th>
                    <th className={cn(salesTh, 'min-w-[11rem] max-w-[14rem]')}>名称</th>
                    <th className={cn(salesTh, 'min-w-[10rem] max-w-[12rem]')}>品类</th>
                    <th className={cn(salesTh, 'text-right')}>销量</th>
                    <th className={cn(salesTh, 'min-w-[8rem]')}>站点</th>
                    <th className={cn(salesTh, 'text-center')}>区域</th>
                    <th className={cn(salesTh, 'min-w-[6.5rem]')}>平台</th>
                    <th className={cn(salesTh, 'min-w-[5.5rem]')}>发货仓</th>
                    <th className={cn(salesTh, 'min-w-[4rem]')}>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyData?.items.map((row) => (
                    <tr key={row.id} className={salesTr}>
                      <td
                        className={cn(
                          salesTd,
                          'sticky left-0 z-10 whitespace-nowrap bg-card font-mono text-text-main shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] group-hover:bg-muted/30',
                        )}
                      >
                        {String(row.saleDate).slice(0, 10)}
                      </td>
                      <td
                        className={cn(
                          salesTd,
                          'sticky left-[6.5rem] z-10 max-w-[7.5rem] bg-card font-mono text-primary shadow-[2px_0_4px_-2px_rgba(0,0,0,0.06)] group-hover:bg-muted/30',
                        )}
                        title={row.skuCode}
                      >
                        <span className="block truncate">{row.skuCode}</span>
                      </td>
                      <CellText value={row.skuName || '—'} clamp={2} />
                      <CellText value={row.category ?? '—'} className="text-xs text-text-sub" clamp={2} />
                      <td className={cn(salesTd, 'text-right font-numeric tabular-nums font-medium text-primary')}>
                        {row.qtySold.toLocaleString()}
                      </td>
                      <td className={cn(salesTd, 'max-w-[10rem] text-text-sub')} title={row.station || undefined}>
                        <span className="block truncate">{row.station || '—'}</span>
                      </td>
                      <td className={cn(salesTd, 'text-center')}>
                        <RegionBadge code={row.salesRegion} />
                      </td>
                      <td className={cn(salesTd, 'font-mono text-xs text-text-sub')} title={row.channel ?? undefined}>
                        <span className="block truncate">{row.channel?.toUpperCase() ?? '—'}</span>
                      </td>
                      <td
                        className={cn(salesTd, 'max-w-[6rem] font-mono text-xs text-text-sub')}
                        title={row.warehouseCode ?? undefined}
                      >
                        <span className="block truncate">{row.warehouseCode ?? '—'}</span>
                      </td>
                      <td className={cn(salesTd, 'whitespace-nowrap text-xs text-text-sub')}>
                        {formatSourceLabel(row.source)}
                      </td>
                    </tr>
                  ))}
                  {!dailyData?.items.length && (
                    <tr>
                      <td colSpan={10} className="p-4 text-center text-text-hint">
                        暂无日销量数据，请点击上方「导入销量」
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={salesTableWrap}>
              <table className="w-full min-w-[900px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={salesTh}>月份</th>
                    <th className={salesTh}>SKU</th>
                    <th className={cn(salesTh, 'min-w-[11rem]')}>名称</th>
                    <th className={cn(salesTh, 'min-w-[12rem]')}>品类</th>
                    <th className={cn(salesTh, 'text-right')}>月销量</th>
                    <th className={salesTh}>平台</th>
                    <th className={salesTh}>来源</th>
                  </tr>
                </thead>
                <tbody>
                  {monthlyData?.items.map((row) => (
                    <tr key={row.id} className={salesTr}>
                      <td className={cn(salesTd, 'font-mono whitespace-nowrap')}>{row.saleMonth}</td>
                      <td className={cn(salesTd, 'max-w-[8rem] font-mono text-primary')} title={row.skuCode}>
                        <span className="block truncate">{row.skuCode}</span>
                      </td>
                      <CellText value={row.skuName || '—'} clamp={2} />
                      <CellText value={row.category ?? '—'} className="text-xs text-text-sub" clamp={2} />
                      <td className={cn(salesTd, 'text-right font-numeric tabular-nums font-medium text-primary')}>
                        {row.qtySold.toLocaleString()}
                      </td>
                      <td className={cn(salesTd, 'font-mono text-xs text-text-sub')} title={row.channel}>
                        <span className="block truncate">{row.channel?.toUpperCase()}</span>
                      </td>
                      <td className={cn(salesTd, 'text-xs text-text-sub')}>{formatSourceLabel(row.source)}</td>
                    </tr>
                  ))}
                  {!monthlyData?.items.length && (
                    <tr>
                      <td colSpan={7} className="p-4 text-center text-text-hint">
                        暂无月销量数据，请先完成日销量导入（系统自动聚合月表）
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
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
