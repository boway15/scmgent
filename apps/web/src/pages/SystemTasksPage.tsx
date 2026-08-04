import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { SCHEDULED_TASKS, TASK_NAME_LABELS } from '@/lib/scheduled-tasks';
import { cn, formatDateTimeCst } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  success: '成功',
  failed: '失败',
};

type TabKey = 'runs' | 'schedule';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'runs', label: '最近运行' },
  { key: 'schedule', label: '任务计划' },
];

function formatTriggeredBy(value: string | null | undefined): string {
  if (!value) return '-';
  if (value === 'cron') return '定时';
  if (value === 'manual') return '手动';
  return value;
}

export function SystemTasksPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('runs');
  const [message, setMessage] = useState<string | null>(null);
  const [runningPath, setRunningPath] = useState<string | null>(null);

  const { data: runs = [], isLoading, isFetching, refetch } = useQuery({
    queryKey: ['task-runs'],
    queryFn: () => api.getTaskRuns(),
    refetchInterval: (query) => {
      const list = query.state.data ?? [];
      return list.some((r) => r.status === 'running') ? 5000 : false;
    },
  });

  const trigger = useMutation({
    mutationFn: (path: string) => api.runScheduledTask(path),
    onMutate: (path) => {
      setRunningPath(path);
      setMessage(null);
    },
    onSuccess: (result) => {
      const skipped = result && typeof result === 'object' && 'skipped' in result && result.skipped;
      setMessage(
        skipped
          ? `已跳过：${(result as { message?: string }).message ?? '任务互斥或进行中'}`
          : '已启动，请在「最近运行」中查看结果（长任务可能需稍候刷新）',
      );
      setTab('runs');
      void queryClient.invalidateQueries({ queryKey: ['task-runs'] });
    },
    onError: (err: Error) => {
      setMessage(err.message || '触发失败');
    },
    onSettled: () => {
      setRunningPath(null);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="定时任务" />
      <p className="text-sm text-text-sub -mt-4">
        由 Docker cron 服务按 Asia/Shanghai 调度；本页可查看计划与手动触发。修改时刻请改{' '}
        <code className="rounded bg-muted px-1">deploy/cron/crontab</code> 后重建 cron 镜像。
      </p>

      {message && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-text-main">{message}</p>
      )}

      <nav className="flex gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'relative -mb-px border-b-2 px-4 py-2.5 text-sm transition-colors',
              tab === item.key
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-text-sub hover:text-text-main',
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'runs' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle>最近运行记录</CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-sm text-text-sub">
                {isFetching ? '刷新中…' : `共 ${runs.length} 条`}
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
                    <th className="p-2 font-normal">开始时间</th>
                    <th className="p-2 font-normal">任务</th>
                    <th className="p-2 font-normal">状态</th>
                    <th className="p-2 font-normal">触发</th>
                    <th className="p-2 font-normal">摘要 / 错误</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run) => (
                    <tr key={run.id} className="border-b border-border/60 align-top">
                      <td className="p-2 whitespace-nowrap text-text-sub">
                        {formatDateTimeCst(run.startedAt)}
                      </td>
                      <td className="p-2 text-text-main">
                        {TASK_NAME_LABELS[run.taskName] ?? run.taskName}
                      </td>
                      <td className="p-2 text-text-main">{STATUS_LABELS[run.status] ?? run.status}</td>
                      <td className="p-2 text-text-sub">{formatTriggeredBy(run.triggeredBy)}</td>
                      <td className="p-2 max-w-lg break-all text-text-sub">
                        {run.errorMessage || run.resultSummary || '-'}
                      </td>
                    </tr>
                  ))}
                  {!runs.length && (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-text-hint">
                        暂无运行记录
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'schedule' && (
        <Card>
          <CardHeader>
            <CardTitle>任务计划</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">任务</th>
                  <th className="p-2 font-normal">计划</th>
                  <th className="p-2 font-normal">说明</th>
                  <th className="p-2 font-normal w-28">操作</th>
                </tr>
              </thead>
              <tbody>
                {SCHEDULED_TASKS.map((task) => (
                  <tr key={task.id} className="border-b border-border/60 align-top">
                    <td className="p-2 text-text-main font-medium">{task.name}</td>
                    <td className="p-2 text-text-sub">
                      <div>{task.cronLabel}</div>
                      <div className="font-mono text-xs text-text-hint">{task.cron}</div>
                    </td>
                    <td className="p-2 text-text-sub">{task.description}</td>
                    <td className="p-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={trigger.isPending}
                        onClick={() => trigger.mutate(task.path)}
                      >
                        {runningPath === task.path ? '执行中…' : '立即执行'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
