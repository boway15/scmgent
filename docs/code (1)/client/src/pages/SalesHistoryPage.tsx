import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';

export function SalesHistoryPage() {
  const defaultTo = new Date().toISOString().slice(0, 10);
  const defaultFrom = new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10);

  const [skuCode, setSkuCode] = useState('');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [channel, setChannel] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [applied, setApplied] = useState({
    skuCode: '',
    from: defaultFrom,
    to: defaultTo,
    channel: '',
    warehouse: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['sales-history', applied],
    queryFn: () =>
      api.getSalesHistory({
        skuCode: applied.skuCode || undefined,
        from: applied.from || undefined,
        to: applied.to || undefined,
        channel: applied.channel || undefined,
        warehouse: applied.warehouse || undefined,
      }),
  });

  const applyFilters = () => {
    setApplied({ skuCode, from, to, channel, warehouse });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="销量历史">
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              api.exportSalesHistoryCsv({
                skuCode: applied.skuCode || undefined,
                from: applied.from || undefined,
                to: applied.to || undefined,
                channel: applied.channel || undefined,
                warehouse: applied.warehouse || undefined,
              })
            }
          >
            导出 CSV
          </Button>
          <Link to="/data/import?type=sales" className={buttonVariants({ variant: 'outline' })}>
            导入销量
          </Link>
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>筛选</CardTitle>
          <p className="text-sm text-text-sub">用于核对补货算法输入数据（默认近 90 天）</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Input
            placeholder="SKU 编号"
            className="h-9 w-36"
            value={skuCode}
            onChange={(e) => setSkuCode(e.target.value)}
          />
          <Input type="date" className="h-9 w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input type="date" className="h-9 w-40" value={to} onChange={(e) => setTo(e.target.value)} />
          <Input
            placeholder="渠道"
            className="h-9 w-32"
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
          />
          <Input
            placeholder="发货仓"
            className="h-9 w-32"
            value={warehouse}
            onChange={(e) => setWarehouse(e.target.value)}
          />
          <Button variant="outline" onClick={applyFilters}>
            查询
          </Button>
        </CardContent>
      </Card>

      {data && (
        <p className="text-sm text-text-sub">
          共 {data.summary.rowCount} 条记录，销量合计 <span className="font-numeric text-primary">{data.summary.totalQty}</span>
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>销量明细</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">日期</th>
                  <th className="p-2 font-normal">SKU</th>
                  <th className="p-2 font-normal">名称</th>
                  <th className="p-2 font-normal">销量</th>
                  <th className="p-2 font-normal">渠道</th>
                  <th className="p-2 font-normal">发货仓</th>
                  <th className="p-2 font-normal">来源</th>
                </tr>
              </thead>
              <tbody>
                {data?.items.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="p-2">{String(row.saleDate).slice(0, 10)}</td>
                    <td className="p-2 font-mono">{row.skuCode}</td>
                    <td className="p-2">{row.skuName}</td>
                    <td className="p-2 font-numeric text-primary">{row.qtySold}</td>
                    <td className="p-2 text-text-sub">{row.channel ?? '-'}</td>
                    <td className="p-2 font-mono text-text-sub">{row.warehouseCode ?? '-'}</td>
                    <td className="p-2 text-text-sub">{row.source}</td>
                  </tr>
                ))}
                {!data?.items.length && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-text-hint">
                      暂无数据，请前往
                      {' '}
                      <Link to="/data/import?type=sales" className="text-primary hover:underline">
                        数据导入
                      </Link>
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
