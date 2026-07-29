import { useQuery } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/PageHeader';
import { QueryErrorFallback } from '@/components/QueryErrorFallback';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api, type PlanningDashboard } from '@/lib/api';
import { cn, formatDateTimeCst } from '@/lib/utils';

type PlanningDashboardCard = {
  label: string;
  value: string;
  href: string;
  highlight?: boolean;
};

export function buildPlanningDashboardCards(
  dashboard: PlanningDashboard,
): PlanningDashboardCard[] {
  return [
    {
      label: '启用 SKU',
      value: String(dashboard.skuActiveCount),
      href: '/inventory/overview',
    },
    {
      label: '红灯风险',
      value: String(dashboard.healthRedCount),
      href: '/inventory/overview',
      highlight: dashboard.healthRedCount > 0,
    },
    {
      label: '黄灯预警',
      value: String(dashboard.healthYellowCount),
      href: '/inventory/overview',
      highlight: dashboard.healthYellowCount > 0,
    },
    {
      label: '低于补货点',
      value: String(dashboard.belowRopCount),
      href: '/inventory/alerts',
      highlight: dashboard.belowRopCount > 0,
    },
    {
      label: '待处理补货建议',
      value: String(dashboard.pendingSuggestions),
      href: '/pmc/suggestions',
      highlight: dashboard.pendingSuggestions > 0,
    },
    {
      label: '延期采购跟单',
      value: String(dashboard.delayedDraftsEtaAvailable),
      href: '/pmc/tracking',
      highlight: dashboard.delayedDraftsEtaAvailable > 0,
    },
    {
      label: '延期发运',
      value: String(dashboard.delayedShipments),
      href: '/pmc/shipments',
      highlight: dashboard.delayedShipments > 0,
    },
    {
      label: '断货风险率（近似）',
      value: `${(dashboard.stockoutRateApprox * 100).toFixed(1)}%`,
      href: '/inventory/overview',
      highlight: dashboard.stockoutRateApprox > 0,
    },
  ];
}

const WORKBENCH_LINKS = [
  { label: '补货建议', description: '审核并采纳待处理建议', href: '/pmc/suggestions' },
  { label: '采购跟单', description: '处理预计可用日期延期', href: '/pmc/tracking' },
  { label: '发运管理', description: '检查延期发运与节点', href: '/pmc/shipments' },
  { label: 'SKU 库存规划', description: '从库存总览进入单 SKU 规划', href: '/inventory/planning' },
] as const;

export function PlanningDashboardPage() {
  const dashboard = useQuery({
    queryKey: ['planning-dashboard'],
    queryFn: api.getPlanningDashboard,
  });

  if (dashboard.isLoading) return <p className="text-text-sub">加载规划驾驶舱中...</p>;
  if (dashboard.isError || !dashboard.data) {
    return (
      <div className="space-y-6">
        <PageHeader title="规划驾驶舱" description="库存风险、补货与履约关键指标" />
        <QueryErrorFallback
          error={dashboard.error}
          onRetry={() => dashboard.refetch()}
          title="规划驾驶舱加载失败"
        />
      </div>
    );
  }

  const cards = buildPlanningDashboardCards(dashboard.data);

  return (
    <div className="space-y-6">
      <PageHeader title="规划驾驶舱" description="库存风险、补货与履约关键指标" />

      <p className="text-sm text-text-sub">
        统计时间：{formatDateTimeCst(dashboard.data.calculatedAt)}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <Link key={card.label} to={card.href}>
            <Card
              className={cn(
                'h-full shadow-card transition-shadow hover:shadow-md',
                card.highlight && 'border-primary/40',
              )}
            >
              <CardContent className="pt-6">
                <p className="text-sm text-text-sub">{card.label}</p>
                <p
                  className={cn(
                    'mt-2 font-mono text-2xl font-semibold',
                    card.highlight ? 'text-primary' : 'text-text-main',
                  )}
                >
                  {card.value}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="text-base">规划工作台</CardTitle>
          <p className="text-sm text-text-sub">点击进入明细列表继续处理</p>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {WORKBENCH_LINKS.map((item) => (
            <Link
              key={item.label}
              to={item.href}
              className="group rounded-md border border-border bg-card px-4 py-3 hover:border-primary/40 hover:bg-muted/50"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-text-main">{item.label}</span>
                <ArrowRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-1 text-xs text-text-sub">{item.description}</p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
