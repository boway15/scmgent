import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DownloadJob } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { cn, formatDateTimeCst } from '@/lib/utils';

const STATUS_LABELS: Record<DownloadJob['status'], string> = {
  pending: '排队中',
  running: '生成中',
  ready: '可下载',
  failed: '失败',
  cancelled: '已取消',
  expired: '已过期',
};

const STATUS_FILTERS: Array<{ value: string; label: string }> = [
  { value: '', label: '全部' },
  { value: 'pending', label: '排队中' },
  { value: 'running', label: '生成中' },
  { value: 'ready', label: '可下载' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
  { value: 'expired', label: '已过期' },
];

function formatBytes(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size)) return '-';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function expiryMeta(expiresAt: string): {
  label: string;
  remainingLabel: string;
  urgent: boolean;
  expired: boolean;
} {
  const end = new Date(expiresAt).getTime();
  if (Number.isNaN(end)) {
    return { label: '-', remainingLabel: '', urgent: false, expired: false };
  }
  const ms = end - Date.now();
  if (ms <= 0) {
    return { label: formatDateTimeCst(expiresAt), remainingLabel: '已过期', urgent: true, expired: true };
  }
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return {
    label: formatDateTimeCst(expiresAt),
    remainingLabel: days <= 1 ? '不足 1 天' : `剩 ${days} 天`,
    urgent: days <= 3,
    expired: false,
  };
}

export function DownloadsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ['download-jobs', page, pageSize, status],
    queryFn: () =>
      api.listDownloadJobs({
        page,
        pageSize,
        status: status || undefined,
      }),
    refetchInterval: (query) => {
      const list = query.state.data?.items ?? [];
      return list.some((j) => j.status === 'pending' || j.status === 'running') ? 4000 : false;
    },
  });

  const items = data?.items ?? [];

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['download-jobs'] });

  const downloadMut = useMutation({
    mutationFn: (id: string) => api.downloadJobFile(id),
    onMutate: (id) => {
      setBusyId(id);
      setMessage(null);
    },
    onError: (err: Error) => setMessage(err.message || '下载失败'),
    onSettled: () => setBusyId(null),
  });

  const retryMut = useMutation({
    mutationFn: (id: string) => api.retryDownloadJob(id),
    onMutate: (id) => {
      setBusyId(id);
      setMessage(null);
    },
    onSuccess: (res) => {
      setMessage(res.message || '已重新加入队列');
      invalidate();
    },
    onError: (err: Error) => setMessage(err.message || '重试失败'),
    onSettled: () => setBusyId(null),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => api.cancelDownloadJob(id),
    onMutate: (id) => {
      setBusyId(id);
      setMessage(null);
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setMessage(err.message || '取消失败'),
    onSettled: () => setBusyId(null),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.deleteDownloadJob(id),
    onMutate: (id) => {
      setBusyId(id);
      setMessage(null);
    },
    onSuccess: () => invalidate(),
    onError: (err: Error) => setMessage(err.message || '删除失败'),
    onSettled: () => setBusyId(null),
  });

  return (
    <div className="space-y-6">
      <PageHeader title="下载中心" />
      <p className="text-sm text-text-sub -mt-4">
        仅显示你本人发起的导出任务。文件生成后可下载，有效期{' '}
        {data?.retentionDays ?? 15} 天，逾期自动清空。
      </p>

      {message && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-text-main">
          {message}
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>我的下载</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              {STATUS_FILTERS.map((opt) => (
                <option key={opt.value || 'all'} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="text-sm text-text-sub">
              {isFetching ? '刷新中…' : `共 ${data?.total ?? 0} 条`}
            </span>
            <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              刷新
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">创建时间</th>
                  <th className="p-2 font-normal">名称</th>
                  <th className="p-2 font-normal">状态</th>
                  <th className="p-2 font-normal">大小</th>
                  <th className="p-2 font-normal">有效期</th>
                  <th className="p-2 font-normal">完成时间</th>
                  <th className="p-2 font-normal w-56">操作</th>
                </tr>
              </thead>
              <tbody>
                {items.map((job) => {
                  const busy = busyId === job.id;
                  const expiry = expiryMeta(job.expiresAt);
                  const canDownload = job.status === 'ready' && !expiry.expired;
                  return (
                    <tr key={job.id} className="border-b border-border/60 align-top">
                      <td className="p-2 whitespace-nowrap text-text-sub">
                        {formatDateTimeCst(job.createdAt)}
                      </td>
                      <td className="p-2 text-text-main">
                        <div className="font-medium">{job.title}</div>
                        <div className="text-xs text-text-hint break-all">{job.fileName}</div>
                        {job.errorMessage && (
                          <div className="mt-1 text-xs text-destructive break-all">
                            {job.errorMessage}
                          </div>
                        )}
                      </td>
                      <td className="p-2">
                        <span
                          className={cn(
                            job.status === 'ready' && !expiry.expired && 'text-emerald-700',
                            (job.status === 'failed' || expiry.expired || job.status === 'expired') &&
                              'text-destructive',
                            (job.status === 'pending' || job.status === 'running') &&
                              'text-amber-700',
                          )}
                        >
                          {expiry.expired && job.status === 'ready'
                            ? '已过期'
                            : (STATUS_LABELS[job.status] ?? job.status)}
                        </span>
                      </td>
                      <td className="p-2 text-text-sub">{formatBytes(job.fileSize)}</td>
                      <td className="p-2 whitespace-nowrap text-text-sub">
                        <div className={cn(expiry.urgent && 'text-amber-700', expiry.expired && 'text-destructive')}>
                          {expiry.label}
                        </div>
                        {expiry.remainingLabel && (
                          <div
                            className={cn(
                              'text-xs',
                              expiry.expired || expiry.urgent ? 'text-amber-700' : 'text-text-hint',
                              expiry.expired && 'text-destructive',
                            )}
                          >
                            {expiry.remainingLabel}
                          </div>
                        )}
                      </td>
                      <td className="p-2 whitespace-nowrap text-text-sub">
                        {job.finishedAt ? formatDateTimeCst(job.finishedAt) : '-'}
                      </td>
                      <td className="p-2">
                        <div className="flex flex-wrap gap-1">
                          {canDownload && (
                            <Button
                              size="sm"
                              disabled={busy}
                              onClick={() => downloadMut.mutate(job.id)}
                            >
                              下载
                            </Button>
                          )}
                          {(job.status === 'pending' || job.status === 'running') && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => cancelMut.mutate(job.id)}
                            >
                              取消
                            </Button>
                          )}
                          {(job.status === 'failed' ||
                            job.status === 'cancelled' ||
                            job.status === 'expired') && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy}
                              onClick={() => retryMut.mutate(job.id)}
                            >
                              重试
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => {
                              if (window.confirm('确认删除该任务及文件？')) {
                                deleteMut.mutate(job.id);
                              }
                            }}
                          >
                            删除
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!items.length && (
                  <tr>
                    <td colSpan={7} className="p-4 text-center text-text-hint">
                      暂无下载任务。在业务页点击导出会出现在这里。
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          {!isLoading && (
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={data?.total ?? 0}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next);
                setPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
