import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { api, type QcReinspectionListItem } from '@/lib/api';

const COLUMNS: Array<{ key: keyof QcReinspectionListItem; label: string; numeric?: boolean }> = [
  { key: 'sourceRecordId', label: '来源记录ID', numeric: true },
  { key: 'insertedAt', label: '首次插入时间' },
  { key: 'syncedAt', label: '数据同步时间' },
  { key: 'supplierShortName', label: '供应商简称' },
  { key: 'inspectionStatus', label: '验货状态' },
  { key: 'purchaseOrderNo', label: '采购单号' },
  { key: 'demandNo', label: '需求单号' },
  { key: 'sku', label: 'SKU' },
  { key: 'productName', label: '品名' },
  { key: 'cartonCount', label: '总箱数', numeric: true },
  { key: 'pieceCount', label: '总件数', numeric: true },
  { key: 'destWarehouse', label: '目的仓' },
  { key: 'factoryType', label: '工厂类型' },
  { key: 'expectedShipDate', label: '期望出货日期' },
  { key: 'containerCartonCount', label: '货柜实发箱数', numeric: true },
  { key: 'containerPieceCount', label: '货柜实发数量', numeric: true },
  { key: 'transferStatus', label: '调拨状态' },
  { key: 'followUpReadyAt', label: '跟单货好时间' },
  { key: 'goodsReadyAt', label: '货好时间' },
  { key: 'gapDays', label: '时间差(天)', numeric: true },
  { key: 'loadingNote', label: '装柜备注' },
];

function formatInsertedAt(iso: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function cellText(row: QcReinspectionListItem, key: keyof QcReinspectionListItem) {
  if (key === 'insertedAt') return formatInsertedAt(row.insertedAt);
  if (key === 'syncedAt') return formatInsertedAt(row.syncedAt);
  const value = row[key];
  if (value == null || value === '') return '—';
  return String(value);
}

export function QcReinspectionPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [appliedKeyword, pageSize]);

  const listQuery = useQuery({
    queryKey: ['qc-reinspection', page, pageSize, appliedKeyword],
    queryFn: () =>
      api.listQcReinspection({
        page,
        pageSize,
        keyword: appliedKeyword || undefined,
      }),
  });

  const syncMutation = useMutation({
    mutationFn: () => api.syncQcReinspection(),
    onSuccess: async (result) => {
      setMessage(
        `已同步。源视图 ${result.sourceCount} 条，新写入 ${result.created} 条，更新同步时间 ${result.refreshed} 条。`,
      );
      await qc.invalidateQueries({ queryKey: ['qc-reinspection'] });
    },
    onError: (err: Error) => {
      setMessage(err.message || '同步失败');
    },
  });

  const items = listQuery.data?.items ?? [];
  const total = listQuery.data?.total ?? 0;

  return (
    <div>
      <PageHeader
        title="二次验货"
        description="从采购跟进「二次验货」视图读入，再写入飞书「需二次验货数据」。首次插入时间只写一次；数据同步时间每次同步都会更新。"
      >
        <Button onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
          {syncMutation.isPending ? '同步中…' : '同步飞书'}
        </Button>
      </PageHeader>

      <Card className="shadow-card">
        <CardContent className="pt-6">
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => setAppliedKeyword(keyword.trim())}
            placeholder="来源记录ID / 供应商简称 / SKU / 采购单号 / 需求单号"
          />
          {message ? <p className="mb-3 text-sm text-text-sub">{message}</p> : null}
          {listQuery.isError ? (
            <p className="mb-3 text-sm text-text-sub">
              {(listQuery.error as Error).message || '列表加载失败'}
            </p>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1400px] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-text-sub">
                  {COLUMNS.map((column) => (
                    <th key={column.key} className="whitespace-nowrap px-3 py-2 font-normal">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-3 py-10 text-center text-text-hint">
                      {listQuery.isLoading ? '加载中…' : '还没有二次验货数据。点击「同步飞书」生成。'}
                    </td>
                  </tr>
                ) : (
                  items.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      {COLUMNS.map((column) => (
                        <td
                          key={column.key}
                          className={`max-w-[240px] truncate px-3 py-2 text-text-main ${column.numeric ? 'font-mono' : ''}`}
                          title={cellText(row, column.key)}
                        >
                          {cellText(row, column.key)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
