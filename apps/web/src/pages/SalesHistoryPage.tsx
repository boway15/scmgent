import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ImportDrawer } from '@/components/import/ImportDrawer';
import { useImportDrawer } from '@/hooks/use-import-drawer';
import { CategorySearchSelect } from '@/components/CategorySearchSelect';
import { cn } from '@/lib/utils';

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
  const qc = useQueryClient();
  const { open: importOpen, openDrawer: openImportDrawer, closeDrawer: closeImportDrawer } = useImportDrawer();
  const [dimension, setDimension] = useState<SalesDimension>('daily');

  const [skuCode, setSkuCode] = useState('');
  const [from, setFrom] = useState(defaultDailyFrom);
  const [to, setTo] = useState(defaultDailyTo);
  const [monthFrom, setMonthFrom] = useState(defaultMonthlyFrom);
  const [monthTo, setMonthTo] = useState(defaultMonthlyTo);
  const [channel, setChannel] = useState('');
  const [warehouse, setWarehouse] = useState('');
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
    queryKey: ['sales-history-daily', applied, page, pageSize],
    queryFn: () =>
      api.getSalesHistory({
        skuCode: applied.skuCode || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        channel: applied.channel || undefined,
        warehouse: applied.warehouse || undefined,
        category: applied.category || undefined,
        page,
        pageSize,
      }),
    enabled: dimension === 'daily',
  });

  const { data: monthlyData, isLoading: monthlyLoading } = useQuery({
    queryKey: ['sales-history-monthly', applied, page, pageSize],
    queryFn: () =>
      api.getSalesHistoryMonthly({
        skuCode: applied.skuCode || undefined,
        from: applied.monthFrom || undefined,
        to: applied.monthTo || undefined,
        channel: applied.channel || undefined,
        category: applied.category || undefined,
        page,
        pageSize,
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
        category: applied.category || undefined,
      });
      return;
    }
    void api.exportSalesHistoryMonthlyCsv({
      skuCode: applied.skuCode || undefined,
      from: applied.monthFrom || undefined,
      to: applied.monthTo || undefined,
      channel: applied.channel || undefined,
      category: applied.category || undefined,
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

      <Card>
        <CardHeader>
          <CardTitle>筛选</CardTitle>
          <p className="text-sm text-text-sub">
            {dimension === 'daily'
              ? '日销量：滚动保留近一年明细，默认近 90 天，用于核对补货算法输入'
              : '月销量：全历史月汇总，用于同比与长周期分析'}
          </p>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="SKU 编号"
            className="h-9 w-36"
            value={skuCode}
            onChange={(e) => setSkuCode(e.target.value)}
          />
          {dimension === 'daily' ? (
            <>
              <Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
            </>
          ) : (
            <>
              <Input
                type="month"
                className="h-9 w-40"
                value={monthFrom}
                onChange={(e) => setMonthFrom(e.target.value)}
              />
              <Input
                type="month"
                className="h-9 w-40"
                value={monthTo}
                onChange={(e) => setMonthTo(e.target.value)}
              />
            </>
          )}
          <Input
            placeholder="渠道"
            className="h-9 w-32"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          />
          {dimension === 'daily' ? (
            <Input
              placeholder="发货仓"
              className="h-9 w-32"
              value={warehouse}
              onChange={(e) => setWarehouse(e.target.value)}
            />
          ) : null}
          <CategorySearchSelect value={category} onChange={setCategory} />
          <Button variant="outline" onClick={applyFilters}>
            查询
          </Button>
        </CardContent>
      </Card>

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
        <p className="text-sm text-text-sub">
          共 {data.summary.rowCount.toLocaleString()} 条
          {dimension === 'daily' ? '日销量' : '月销量'}明细，销量合计{' '}
          <span className="font-numeric text-primary">{data.summary.totalQty.toLocaleString()}</span>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{dimension === 'daily' ? '日销量明细' : '月销量明细'}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : dimension === 'daily' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">日期</th>
                  <th className="p-2 font-normal">SKU</th>
                  <th className="p-2 font-normal">名称</th>
                  <th className="p-2 font-normal">品类</th>
                  <th className="p-2 font-normal">销量</th>
                  <th className="p-2 font-normal">渠道</th>
                  <th className="p-2 font-normal">发货仓</th>
                  <th className="p-2 font-normal">来源</th>
                </tr>
              </thead>
              <tbody>
                {dailyData?.items.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="p-2">{String(row.saleDate).slice(0, 10)}</td>
                    <td className="p-2 font-mono">{row.skuCode}</td>
                    <td className="p-2">{row.skuName}</td>
                    <td className="p-2 text-text-sub">{row.category ?? '-'}</td>
                    <td className="p-2 font-numeric text-primary">{row.qtySold}</td>
                    <td className="p-2 text-text-sub">{row.channel ?? '-'}</td>
                    <td className="p-2 font-mono text-text-sub">{row.warehouseCode ?? '-'}</td>
                    <td className="p-2 text-text-sub">{row.source}</td>
                  </tr>
                ))}
                {!dailyData?.items.length && (
                  <tr>
                    <td colSpan={8} className="p-4 text-center text-text-hint">
                      暂无日销量数据，请点击上方「导入销量」
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">月份</th>
                  <th className="p-2 font-normal">SKU</th>
                  <th className="p-2 font-normal">名称</th>
                  <th className="p-2 font-normal">品类</th>
                  <th className="p-2 font-normal">月销量</th>
                  <th className="p-2 font-normal">渠道</th>
                  <th className="p-2 font-normal">来源</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData?.items.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="p-2 font-mono">{row.saleMonth}</td>
                    <td className="p-2 font-mono">{row.skuCode}</td>
                    <td className="p-2">{row.skuName}</td>
                    <td className="p-2 text-text-sub">{row.category ?? '-'}</td>
                    <td className="p-2 font-numeric text-primary">{row.qtySold}</td>
                    <td className="p-2 text-text-sub">{row.channel ?? '-'}</td>
                    <td className="p-2 text-text-sub">{row.source}</td>
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
