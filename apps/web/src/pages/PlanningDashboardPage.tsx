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
  hint?: string;
};

export function buildPlanningDashboardCards(
  dashboard: PlanningDashboard,
): PlanningDashboardCard[] {
  const planningEligible = dashboard.skuPlanningEligibleCount ?? dashboard.skuActiveCount;
  const redSkuCount = dashboard.healthRedSkuCount ?? dashboard.healthRedCount;
  const yellowSkuCount = dashboard.healthYellowSkuCount ?? dashboard.healthYellowCount;

  const operational = dashboard.skuOperationalCount ?? planningEligible;

  return [
    {
      label: '运营 SKU',
      value: String(operational),
      href: '/inventory/overview',
      hint: '近 30 天出现在周转表，或近 90 天有销量；驾驶舱 KPI 分母',
    },
    {
      label: '启用 SKU',
      value: String(dashboard.skuActiveCount),
      href: '/data/products?tab=sku',
      hint: `主数据全量启用；其中 ${dashboard.skuDormantCount ?? 0} 个为休眠（未满足运营口径）`,
    },
    {
      label: '可规划 SKU',
      value: String(planningEligible),
      href: '/inventory/overview',
      hint: '运营 SKU 中排除疑似停售，参与补货与风险计算',
    },
    {
      label: '疑似停售',
      value: String(dashboard.skuGrayLifecycleCount ?? 0),
      href: '/data/products?tab=sku',
      highlight: (dashboard.skuGrayLifecycleCount ?? 0) > 0,
      hint: 'ERP 停售/下架或生命周期含停售/滞销标签，暂停自动补货',
    },
    {
      label: '预测已覆盖',
      value: String(dashboard.skuForecastCoveredCount ?? 0),
      href: '/data/forecast',
      hint: '可规划 SKU 中已有已发布销量预测的 SKU',
    },
    {
      label: '预测缺口',
      value: String(dashboard.skuForecastGapCount ?? 0),
      href: '/data/forecast',
      highlight: (dashboard.skuForecastGapCount ?? 0) > 0,
      hint: '可规划 SKU 中尚无已发布预测的 SKU',
    },
    {
      label: '预测覆盖率',
      value: `${((dashboard.forecastCoverageRate ?? 0) * 100).toFixed(1)}%`,
      href: '/data/forecast',
      highlight: (dashboard.forecastCoverageRate ?? 0) < 0.8,
      hint: '预测已覆盖 / 可规划 SKU',
    },
    {
      label: '红灯 SKU',
      value: String(redSkuCount),
      href: '/inventory/overview',
      highlight: redSkuCount > 0,
      hint: '任一仓为红灯的 SKU 数',
    },
    {
      label: '黄灯 SKU',
      value: String(yellowSkuCount),
      href: '/inventory/overview',
      highlight: yellowSkuCount > 0,
      hint: '无红灯但有黄灯的 SKU 数',
    },
    {
      label: '7天缺货（确定线）',
      value: String(dashboard.stockoutHorizon7 ?? 0),
      href: '/inventory/alerts',
      highlight: (dashboard.stockoutHorizon7 ?? 0) > 0,
    },
    {
      label: '15天缺货（确定线）',
      value: String(dashboard.stockoutHorizon15 ?? 0),
      href: '/inventory/alerts',
      highlight: (dashboard.stockoutHorizon15 ?? 0) > 0,
    },
    {
      label: '30天缺货（确定线）',
      value: String(dashboard.stockoutHorizon30 ?? 0),
      href: '/inventory/alerts',
      highlight: (dashboard.stockoutHorizon30 ?? 0) > 0,
    },
    {
      label: '库存积压',
      value: String(dashboard.overstockCount ?? 0),
      href: '/inventory/alerts',
      highlight: (dashboard.overstockCount ?? 0) > 0,
    },
    {
      label: '新计划已来不及',
      value: String(dashboard.uncoverableByNewPoCount ?? 0),
      href: '/inventory/alerts',
      highlight: (dashboard.uncoverableByNewPoCount ?? 0) > 0,
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
      label: '数据问题',
      value: String(dashboard.openDataIssueCount ?? 0),
      href: '/inventory/data-issues',
      highlight: (dashboard.openDataIssueCount ?? 0) > 0,
    },
    {
      label: '未定仓供应',
      value: String(dashboard.openUnallocatedLotCount ?? 0),
      href: '/inventory/unallocated',
      highlight: (dashboard.openUnallocatedLotCount ?? 0) > 0,
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
      hint: '红灯 SKU / 可规划 SKU',
    },
  ];
}

const WORKBENCH_LINKS = [
  { label: '数据问题', description: '无期批次、未分仓、占比偏离工单', href: '/inventory/data-issues' },
  { label: '未定仓供应', description: 'OVERSEAS 批次确认目的仓', href: '/inventory/unallocated' },
  { label: '库存三池', description: '本地 / 在途 / 海外批次与可出货日', href: '/inventory/pools' },
  { label: '补货建议', description: '审核并采纳待处理建议', href: '/pmc/suggestions' },
  { label: '采购跟单', description: '处理预计可用日期延期', href: '/pmc/tracking' },
  { label: '发运管理', description: '检查延期发运与节点', href: '/pmc/shipments' },
  { label: 'SKU 库存规划', description: '搜索 SKU 进入单仓规划详情', href: '/inventory/planning' },
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
  const compositionCards = cards.slice(0, 7);
  const riskCards = cards.slice(7);

  return (
    <div className="space-y-6">
      <PageHeader title="规划驾驶舱" description="库存风险、补货与履约关键指标" />

      <p className="text-sm text-text-sub">
        统计时间：{formatDateTimeCst(dashboard.data.calculatedAt)}
      </p>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-text-main">SKU 构成</h2>
          <p className="text-xs text-text-sub">
            运营 {dashboard.data.skuOperationalCount ?? 0} = 可规划 {dashboard.data.skuPlanningEligibleCount ?? 0} + 疑似停售{' '}
            {dashboard.data.skuGrayLifecycleCount ?? 0}
            （主数据启用 {dashboard.data.skuActiveCount}，休眠 {dashboard.data.skuDormantCount ?? 0}）
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {compositionCards.map((card) => (
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
                  {card.hint ? <p className="mt-2 text-xs text-text-sub">{card.hint}</p> : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-text-main">风险与履约</h2>
          <p className="text-xs text-text-sub">红灯/黄灯按 SKU 去重；缺货预警仍按 SKU 计数</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {riskCards.map((card) => (
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
                  {card.hint ? <p className="mt-2 text-xs text-text-sub">{card.hint}</p> : null}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

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
