import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ListPagination } from '@/components/ListPagination';

type Props = {
  versionId: string;
};

export function DemandPlanAccuracyPanel({ versionId }: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [skuCode, setSkuCode] = useState('');
  const [appliedSku, setAppliedSku] = useState('');
  const [exporting, setExporting] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ['demand-plan-accuracy-summary', versionId, page, pageSize, appliedSku],
    queryFn: () =>
      api.getDemandPlanAccuracySummary(versionId, {
        page,
        pageSize,
        skuCode: appliedSku || undefined,
      }),
    enabled: Boolean(versionId),
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      await api.exportDemandPlanAccuracy({
        versionId,
        skuCode: appliedSku || undefined,
      });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(false);
    }
  };

  const data = summaryQuery.data;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="text-base">准确度复盘</CardTitle>
          <p className="mt-1 text-xs text-text-sub">
            计划生效日均 vs 实销日均（有实销的周才计入）。与「导出准确度」CSV 同源。
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={exporting} onClick={() => void handleExport()}>
          {exporting ? '导出中…' : '导出准确度 CSV'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-text-sub">SKU</label>
            <Input
              className="h-8 w-48"
              value={skuCode}
              placeholder="编码，可多值"
              onChange={(e) => setSkuCode(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              setAppliedSku(skuCode.trim());
              setPage(1);
            }}
          >
            查询
          </Button>
        </div>

        {data?.totals ? (
          <p className="text-sm text-text-sub">
            对比 SKU {data.totals.skuCount.toLocaleString()} · 有效周次{' '}
            {data.totals.comparedWeekCount.toLocaleString()}
          </p>
        ) : null}

        {summaryQuery.isLoading ? (
          <p className="text-sm text-text-sub">加载中…</p>
        ) : summaryQuery.isError ? (
          <p className="text-sm text-destructive">
            {summaryQuery.error instanceof Error ? summaryQuery.error.message : '加载失败'}
          </p>
        ) : (
          <>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">SKU</th>
                    <th className="p-2 font-normal">对比周数</th>
                    <th className="p-2 font-normal">MAE</th>
                    <th className="p-2 font-normal">WMAPE</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items ?? []).map((row) => (
                    <tr key={row.skuId} className="border-b border-border/60">
                      <td className="p-2 font-mono">{row.skuCode}</td>
                      <td className="p-2 font-numeric">{row.comparedWeeks}</td>
                      <td className="p-2 font-numeric">
                        {row.mae != null ? row.mae.toFixed(2) : '—'}
                      </td>
                      <td className="p-2 font-numeric">
                        {row.wmape != null ? `${(row.wmape * 100).toFixed(1)}%` : '—'}
                      </td>
                    </tr>
                  ))}
                  {!data?.items.length ? (
                    <tr>
                      <td colSpan={4} className="p-4 text-center text-text-sub">
                        暂无对比数据（需回测开始周且计划周有实销）
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <ListPagination
              page={data?.page ?? page}
              pageSize={data?.pageSize ?? pageSize}
              total={data?.total ?? 0}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
