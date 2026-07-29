import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  api,
  type SapMirrorEntityType,
  type SapMirrorIngestResult,
} from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatDateTimeCst } from '@/lib/utils';

const ENTITY_TYPES: Array<{ value: SapMirrorEntityType; label: string }> = [
  { value: 'merchant', label: '商家 (merchant)' },
  { value: 'sku', label: 'SKU / 物料 (sku)' },
  { value: 'purchase_order', label: '采购订单 (purchase_order)' },
];

const ENTITY_LABELS: Record<SapMirrorEntityType, string> = {
  merchant: '商家',
  sku: 'SKU',
  purchase_order: '采购订单',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  partial: '部分成功',
};

const PO_SYNC_LABELS: Record<string, string> = {
  pending: '待同步',
  synced: '已同步',
  error: '错误',
  ignored: '已忽略',
};

const JSON_PLACEHOLDER = `[
  { "vendorId": "0000100001", "name": "Acme Supplies", "code": "SUP001" }
]`;

function formatTime(value?: string | null): string {
  if (!value) return '-';
  return formatDateTimeCst(value);
}

function RunSummary({ result }: { result: SapMirrorIngestResult }) {
  return (
    <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm space-y-1">
      <p>
        同步完成：新增 {result.inserted}，更新 {result.updated}，跳过 {result.skipped}
      </p>
      {result.errors.length > 0 && (
        <ul className="list-disc pl-5 text-destructive">
          {result.errors.map((err, idx) => (
            <li key={`${err.externalId ?? 'err'}-${idx}`}>
              {err.externalId ? `[${err.externalId}] ` : ''}
              {err.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SapMirrorPage() {
  const queryClient = useQueryClient();
  const [entityType, setEntityType] = useState<SapMirrorEntityType>('merchant');
  const [jsonText, setJsonText] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<SapMirrorIngestResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const runsQuery = useQuery({
    queryKey: ['sap-mirror-runs'],
    queryFn: () => api.getSapMirrorRuns(30),
  });

  const poQuery = useQuery({
    queryKey: ['sap-mirror-purchase-orders'],
    queryFn: () => api.getSapMirrorPurchaseOrders(100),
  });

  const ingest = useMutation({
    mutationFn: (payload: { entityType: SapMirrorEntityType; items: unknown[] }) =>
      api.ingestSapMirror(payload),
    onSuccess: (result) => {
      setLastResult(result);
      setMessage(null);
      void queryClient.invalidateQueries({ queryKey: ['sap-mirror-runs'] });
      if (entityType === 'purchase_order') {
        void queryClient.invalidateQueries({ queryKey: ['sap-mirror-purchase-orders'] });
      }
    },
    onError: (err: Error) => {
      setMessage(err.message || '导入失败');
    },
  });

  const handleSubmit = () => {
    setParseError(null);
    setMessage(null);
    setLastResult(null);

    let items: unknown[];
    try {
      const parsed = JSON.parse(jsonText.trim() || '[]');
      if (!Array.isArray(parsed)) {
        setParseError('JSON 必须是数组');
        return;
      }
      items = parsed;
    } catch {
      setParseError('JSON 格式无效');
      return;
    }

    if (items.length === 0) {
      setParseError('数组不能为空');
      return;
    }

    ingest.mutate({ entityType, items });
  };

  const runs = runsQuery.data?.items ?? [];
  const poItems = poQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="SAP 镜像同步" />
      <p className="text-sm text-text-sub -mt-4">
        通过 JSON fixture 导入 SAP 主数据与采购订单镜像；不连接真实 SAP，仅写入本地镜像表。
      </p>

      {message && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>导入 Fixture</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block space-y-1 text-sm">
            <span className="text-text-sub">实体类型</span>
            <select
              className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 text-sm"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as SapMirrorEntityType)}
            >
              {ENTITY_TYPES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-text-sub">JSON 数组</span>
            <textarea
              className="min-h-[160px] w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs"
              placeholder={JSON_PLACEHOLDER}
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
            />
          </label>

          {parseError && <p className="text-sm text-destructive">{parseError}</p>}
          {lastResult && <RunSummary result={lastResult} />}

          <Button onClick={handleSubmit} disabled={ingest.isPending}>
            {ingest.isPending ? '导入中…' : '提交导入'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>最近同步记录</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void runsQuery.refetch()}
            disabled={runsQuery.isFetching}
          >
            刷新
          </Button>
        </CardHeader>
        <CardContent>
          {runsQuery.isLoading ? (
            <p className="text-text-sub">加载中…</p>
          ) : runs.length === 0 ? (
            <p className="text-text-sub">暂无记录</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">开始时间</th>
                  <th className="p-2 font-normal">实体</th>
                  <th className="p-2 font-normal">状态</th>
                  <th className="p-2 font-normal">摘要</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const summary = run.summary;
                  const summaryText = summary
                    ? `+${summary.inserted ?? 0} / ~${summary.updated ?? 0} / 跳过 ${summary.skipped ?? 0}`
                    : run.errorMessage ?? '-';
                  return (
                    <tr key={run.id} className="border-b border-border/60">
                      <td className="p-2 whitespace-nowrap">{formatTime(run.startedAt)}</td>
                      <td className="p-2">
                        {ENTITY_LABELS[run.entityType as SapMirrorEntityType] ?? run.entityType}
                      </td>
                      <td className="p-2">
                        <span
                          className={cn(
                            run.status === 'failed' && 'text-destructive',
                            run.status === 'partial' && 'text-amber-600',
                            run.status === 'succeeded' && 'text-emerald-600',
                          )}
                        >
                          {RUN_STATUS_LABELS[run.status] ?? run.status}
                        </span>
                      </td>
                      <td className="p-2 text-text-sub">{summaryText}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>采购订单镜像</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void poQuery.refetch()}
            disabled={poQuery.isFetching}
          >
            刷新
          </Button>
        </CardHeader>
        <CardContent>
          {poQuery.isLoading ? (
            <p className="text-text-sub">加载中…</p>
          ) : poItems.length === 0 ? (
            <p className="text-text-sub">暂无 PO 镜像</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">PO 号</th>
                    <th className="p-2 font-normal">外部 ID</th>
                    <th className="p-2 font-normal">商家</th>
                    <th className="p-2 font-normal">订单日期</th>
                    <th className="p-2 font-normal">状态</th>
                    <th className="p-2 font-normal">同步</th>
                    <th className="p-2 font-normal">行数</th>
                    <th className="p-2 font-normal">最后同步</th>
                  </tr>
                </thead>
                <tbody>
                  {poItems.map((po) => (
                    <tr key={po.id} className="border-b border-border/60">
                      <td className="p-2">{po.poNumber ?? '-'}</td>
                      <td className="p-2 font-mono text-xs">{po.externalId}</td>
                      <td className="p-2">{po.merchantCode ?? po.vendorExternalId ?? '-'}</td>
                      <td className="p-2 whitespace-nowrap">{po.orderDate ?? '-'}</td>
                      <td className="p-2">{po.statusRaw ?? '-'}</td>
                      <td className="p-2">
                        {po.syncStatus ? PO_SYNC_LABELS[po.syncStatus] ?? po.syncStatus : '-'}
                      </td>
                      <td className="p-2">{po.lines.length}</td>
                      <td className="p-2 whitespace-nowrap">{formatTime(po.lastSyncAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
