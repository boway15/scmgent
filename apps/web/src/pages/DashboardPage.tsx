import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { QueryErrorFallback } from '@/components/QueryErrorFallback';
import { cn } from '@/lib/utils';

const PRIORITY_STYLE = {
  high: 'border-l-4 border-l-primary',
  medium: 'border-l-4 border-l-amber-500',
  low: 'border-l-4 border-l-border',
};

export function DashboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard'],
    queryFn: api.getDashboard,
  });

  if (isLoading) return <p className="text-text-sub">加载中...</p>;

  if (isError) {
    return (
      <div className="space-y-6">
        <PageHeader title="经营看板" description="今日待办与关键指标一览" />
        <QueryErrorFallback error={error} onRetry={() => refetch()} title="看板数据加载失败" />
      </div>
    );
  }

  if (!data) return <p className="text-text-sub">加载中...</p>;

  const { kpis, todos, trends, dataFreshness, taskRuns } = data;
  const maxQty = Math.max(...(trends?.salesLast7Days.map((d) => d.qty) ?? [1]), 1);

  const formatTaskRun = (label: string, run?: { finishedAt?: string | null; startedAt: string; status: string; resultSummary?: string | null; errorMessage?: string | null } | null) => {
    if (!run) return `${label}：暂无执行记录`;
    const time = String(run.finishedAt ?? run.startedAt).slice(0, 19).replace('T', ' ');
    const detail = run.errorMessage || run.resultSummary || run.status;
    return `${label}：${time} · ${detail}`;
  };

  const kpiCards = [
    { label: '待处理预警', value: kpis.openAlerts, href: '/inventory/alerts', highlight: kpis.openAlerts > 0 },
    { label: '待采纳补货建议', value: kpis.pendingReorderSuggestions, href: '/pmc/suggestions', highlight: kpis.pendingReorderSuggestions > 0 },
    { label: 'PMC 草稿计划', value: kpis.draftPmcPlans, href: '/pmc/list', highlight: kpis.draftPmcPlans > 0 },
    { label: '进行中计划', value: kpis.activePmcPlans, href: '/pmc/list' },
    { label: '采购跟单待跟进', value: kpis.purchaseTrackingPending, href: '/pmc/tracking' },
    { label: '近 7 天销量', value: kpis.salesQtyLast7Days, href: '/data/sales' },
    { label: '启用 SKU 数', value: kpis.activeSkus, href: '/data/products' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="经营看板" description="今日待办与关键指标一览" />

      {(dataFreshness?.latestInventoryDate || dataFreshness?.latestSalesDate || taskRuns) && (
        <Card>
          <CardContent className="grid gap-2 pt-6 text-sm text-text-sub md:grid-cols-2">
            <p>库存最新日期：{dataFreshness?.latestInventoryDate ?? '暂无'}</p>
            <p>销量最新日期：{dataFreshness?.latestSalesDate ?? '暂无'}</p>
            <p>{formatTaskRun('补货预测', taskRuns?.replenishmentForecast)}</p>
            <p>{formatTaskRun('缺货预警', taskRuns?.stockAlert)}</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpiCards.map((k) => (
          <Link key={k.label} to={k.href}>
            <Card className={cn('transition-shadow hover:shadow-md', k.highlight && 'border-primary/40')}>
              <CardContent className="pt-6">
                <p className="text-sm text-text-sub">{k.label}</p>
                <p className={cn('text-2xl font-semibold', k.highlight ? 'text-primary' : 'text-text-main')}>
                  {k.value}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {trends?.salesLast7Days.length ? (
        <Card>
          <CardHeader>
            <CardTitle>近 7 天销量趋势</CardTitle>
            <p className="text-sm text-text-sub">
              近 7 天未处理预警 {kpis.openAlertsLast7Days} 条 · 30 天共 {trends.salesLast30Days.reduce((s, d) => s + d.qty, 0)} 件
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {trends.salesLast7Days.map((d) => (
              <div key={d.date} className="flex items-center gap-3 text-sm">
                <span className="w-24 text-text-sub">{d.date}</span>
                <div className="h-2 flex-1 rounded bg-muted">
                  <div
                    className="h-2 rounded bg-primary"
                    style={{ width: `${Math.round((d.qty / maxQty) * 100)}%` }}
                  />
                </div>
                <span className="w-16 text-right font-numeric text-text-main">{d.qty}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>今日待办</CardTitle>
          <p className="text-sm text-text-sub">按优先级排序，点击跳转处理</p>
        </CardHeader>
        <CardContent className="space-y-2">
          {todos.map((todo, i) => (
            <Link
              key={`${todo.type}-${i}`}
              to={todo.href}
              className={cn(
                'block rounded-md border border-border bg-card px-4 py-3 hover:bg-muted/50',
                PRIORITY_STYLE[todo.priority],
              )}
            >
              <div className="font-medium text-text-main">{todo.title}</div>
              {todo.subtitle && <div className="mt-0.5 text-sm text-text-sub">{todo.subtitle}</div>}
            </Link>
          ))}
          {!todos.length && (
            <p className="py-6 text-center text-text-hint">暂无待办，各模块运行正常</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">补货与计划</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <Link to="/pmc/suggestions" className="block text-primary hover:underline">补货建议</Link>
            <Link to="/pmc/list" className="block text-primary hover:underline">PMC 计划列表</Link>
            <Link to="/data/import?type=sales" className="block text-primary hover:underline">导入销量数据</Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI 助手</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-text-sub">
            <p>本地 FAQ 模式，可解答安全库存、PMC 流程等问题。</p>
            <Link to="/ai/chat" className="mt-2 inline-block text-primary hover:underline">
              打开知识问答
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
