import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ImportType } from '@/lib/api';
import { formatDateTimeCst } from '@/lib/utils';
import {
  formatImportBatchCounts,
  formatImportBatchStatus,
  type ImportBatchListItem,
} from '@/lib/import-batch-display';
type Props = {
  type: ImportType;
  onImportSettled?: () => void;
};

function BatchProgressCell({ batch }: { batch: ImportBatchListItem }) {
  const { primary, secondary } = formatImportBatchCounts(batch);
  return (
    <td className="p-2 font-numeric">
      <div>{primary}</div>
      {secondary ? <div className="text-xs text-text-sub">{secondary}</div> : null}
    </td>
  );
}

export function ImportBatchTable({ type, onImportSettled }: Props) {
  const queryClient = useQueryClient();
  const { data: batches = [] } = useQuery({
    queryKey: ['import-batches', type],
    queryFn: () => api.getImportBatches(type),
    enabled: type === 'inventory' || type === 'sales',
    refetchInterval: (query) => {
      const items = query.state.data ?? [];
      return items.some((b) => b.status === 'pending') ? 2000 : false;
    },
  });

  const hasPending = batches.some((b) => b.status === 'pending');

  useEffect(() => {
    if (!hasPending && batches.some((b) => ['success', 'partial', 'failed'].includes(b.status))) {
      onImportSettled?.();
    }
  }, [hasPending, batches, onImportSettled]);

  useEffect(() => {
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      if (type === 'sales') {
        void queryClient.invalidateQueries({ queryKey: ['sales-history'] });
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [hasPending, type, queryClient]);

  if (!batches.length) return null;

  const progressColumnLabel = type === 'sales' ? '日销量 / SKU 宽表' : '成功 / 总数';

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">最近导入批次</p>
      {type === 'sales' && hasPending ? (
        <p className="text-xs text-amber-700">
          导入在后台进行，请勿重启 Docker。日销量为 0 可能是续导跳过已有行，请看 SKU 宽表进度是否增加。
        </p>
      ) : null}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-text-sub">
            <th className="p-2 font-normal">时间</th>
            <th className="p-2 font-normal">文件</th>
            <th className="p-2 font-normal">状态</th>
            <th className="p-2 font-normal">{progressColumnLabel}</th>
          </tr>
        </thead>
        <tbody>
          {batches.map((batch) => (
            <tr key={batch.id} className="border-b border-border/60 align-top">
              <td className="p-2 whitespace-nowrap">{formatDateTimeCst(batch.createdAt)}</td>
              <td className="p-2 max-w-[12rem] truncate" title={batch.fileName ?? undefined}>
                {batch.fileName ?? '-'}
              </td>
              <td className="p-2">
                <div>{formatImportBatchStatus(batch)}</div>
                {batch.errorSummary && batch.status !== 'pending' ? (
                  <div className="mt-1 max-w-xs text-xs text-red-600 whitespace-pre-wrap">
                    {batch.errorSummary}
                  </div>
                ) : null}
              </td>
              <BatchProgressCell batch={batch} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
