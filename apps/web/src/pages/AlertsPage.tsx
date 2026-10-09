import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { ProductScopeSwitch } from '@/components/ProductScopeSwitch';
import { ALERT_LEVEL_LABEL, INVENTORY_RISK_SCENES, PRICE_REASON_LABEL } from '@/lib/inventory-risk-scenes';
import { useProductScope } from '@/lib/product-scope';
import { cn } from '@/lib/utils';
import {
  orderRecommendationFields,
  RECOMMEND_EMPTY,
  shipRecommendationFields,
  type RecommendationTriple,
} from '@/lib/alert-recommendation-display';
import { downloadAlertListCsv } from '@/lib/alert-list-csv';

function QtyCell({ value }: { value: number | null | undefined }) {
  if (value == null) return <span className="text-text-hint">—</span>;
  return <>{value.toLocaleString()}</>;
}

function SalesWindowCell({
  d7,
  d14,
  d30,
}: {
  d7: number | null | undefined;
  d14: number | null | undefined;
  d30: number | null | undefined;
}) {
  const part = (value: number | null | undefined) =>
    value == null ? '—' : value.toLocaleString();
  return (
    <span className="whitespace-nowrap tabular-nums text-text-sub" title="7天 / 14天 / 30天销量（周转表）">
      {part(d7)}/{part(d14)}/{part(d30)}
    </span>
  );
}

function GapCell({ value, covered }: { value: number | null | undefined; covered?: boolean }) {
  if (covered) {
    return (
      <span className="text-text-hint" title="窗口内在库已覆盖">
        0
      </span>
    );
  }
  if (value != null && value > 0) {
    return <span className="font-medium tabular-nums text-primary">{value.toLocaleString()}</span>;
  }
  return <QtyCell value={value} />;
}

function CategoryCell({
  action,
  hasShippableLots,
  hasUnallocatedLocal,
}: {
  action: string | null | undefined;
  hasShippableLots?: boolean;
  hasUnallocatedLocal?: boolean;
}) {
  const hints: string[] = [];
  if ((action === 'ship_urgent' || action === 'ship') && !hasShippableLots) {
    hints.push('暂无可发，等完工');
  }
  if (hasUnallocatedLocal) hints.push('有未定仓本地货');

  return (
    <div className="min-w-[6.5rem] space-y-1">
      {action ? (
        <span className="inline-block rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium leading-snug text-text-main">
          {ACTION_LABEL[action] ?? action}
        </span>
      ) : (
        <span className="text-text-hint">—</span>
      )}
      {hints.map((hint) => (
        <div key={hint} className="text-[11px] leading-tight text-text-hint">
          {hint}
        </div>
      ))}
    </div>
  );
}

const alertTableWrap = 'max-h-[min(70vh,720px)] overflow-auto rounded-md border border-border';
const alertTh = 'whitespace-nowrap p-2 font-normal';
const alertThGroup = 'border-l border-border p-2 text-center text-xs font-medium text-text-main';
const alertThSub = 'border-l border-border p-2 text-right text-xs font-normal';
const alertTdNum = 'border-l border-border/40 p-2 text-right tabular-nums';
const alertTr = 'group border-b border-border/60 hover:bg-muted/35';
const stickySkuTh =
  'sticky left-0 z-20 bg-muted p-2 font-normal shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]';
const stickySkuTd =
  'sticky left-0 z-10 bg-card p-2 font-mono text-text-main shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)] group-hover:bg-muted/35';

function DateCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-text-hint">—</span>;
  return <>{value}</>;
}

function EmptyDash() {
  return <span className="text-text-hint">-</span>;
}

function YesNoCell({ value }: { value: boolean }) {
  return <span className={cn(value && 'font-medium text-primary')}>{value ? '是' : '否'}</span>;
}

function RecommendDateCell({ value }: { value: string }) {
  if (!value) return <EmptyDash />;
  return <span className="font-mono text-xs">{value}</span>;
}

function RecommendQtyCell({ value }: { value: string }) {
  if (value === '-' || value === RECOMMEND_EMPTY) return <EmptyDash />;
  return <span className="font-medium tabular-nums text-primary">{value}</span>;
}

function RecommendationCells({ rec }: { rec: RecommendationTriple }) {
  return (
    <>
      <td className={cn(alertTdNum, 'text-center')}>
        <YesNoCell value={rec.yes} />
      </td>
      <td className={cn(alertTdNum, 'font-mono text-xs')}>
        <RecommendDateCell value={rec.date} />
      </td>
      <td className={alertTdNum}>
        <RecommendQtyCell value={rec.qty} />
      </td>
    </>
  );
}

const ACTION_LABEL = Object.fromEntries(INVENTORY_RISK_SCENES.map((item) => [item.view, item.label]));

function isStockoutRiskView(action: string | null | undefined): boolean {
  return action === 'price' || action === 'stockout_now' || action === 'stockout_imminent';
}

type RecommendFilterValue = '' | 'yes' | 'no';

function parseRecommendParam(raw: string | null): RecommendFilterValue {
  if (raw === 'yes' || raw === 'no') return raw;
  return '';
}

function RecommendFilterGroup({
  label,
  value,
  onChange,
}: {
  label: string;
  value: RecommendFilterValue;
  onChange: (next: RecommendFilterValue) => void;
}) {
  const options: { id: RecommendFilterValue; text: string }[] = [
    { id: '', text: '全部' },
    { id: 'yes', text: '是' },
    { id: 'no', text: '否' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-text-sub">{label}</span>
      {options.map((opt) => (
        <Button
          key={opt.id || 'all'}
          type="button"
          size="sm"
          variant={value === opt.id ? 'default' : 'outline'}
          onClick={() => onChange(opt.id)}
        >
          {opt.text}
        </Button>
      ))}
    </div>
  );
}

export function AlertsPage() {
  const { productScope } = useProductScope();
  const [params, setParams] = useSearchParams();
  const view = params.get('view');
  const scene = INVENTORY_RISK_SCENES.find((item) => item.view === view);
  const listView = scene?.view ?? 'all';
  const grain = params.get('grain') === 'sku' ? 'sku' : 'warehouse';
  const suggestOrder = parseRecommendParam(params.get('suggestOrder'));
  const suggestShip = parseRecommendParam(params.get('suggestShip'));
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [exporting, setExporting] = useState(false);

  const summary = useQuery({
    queryKey: ['alert-summary', productScope],
    queryFn: () => api.getAlertSummary({ productScope }),
  });

  const { data, isLoading } = useQuery({
    queryKey: [
      'alerts',
      page,
      pageSize,
      appliedKeyword,
      productScope,
      listView,
      grain,
      suggestOrder,
      suggestShip,
    ],
    queryFn: () =>
      api.getAlerts({
        page,
        pageSize,
        q: appliedKeyword || undefined,
        resolved: 'open',
        productScope,
        view: listView,
        grain,
        suggestOrder: suggestOrder || undefined,
        suggestShip: suggestShip || undefined,
      }),
  });

  const [detectHint, setDetectHint] = useState<string | null>(null);

  const runAlert = useMutation({
    mutationFn: async () => {
      const started = await api.runStockAlert();
      if (!started.taskRunId) return started;
      for (let attempt = 0; attempt < 180; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        const run = await api.getTaskRun(started.taskRunId);
        if (run.status === 'success') return run;
        if (run.status === 'failed') {
          throw new Error(run.errorMessage || '库存概览检测失败');
        }
      }
      return { status: 'running' as const, taskRunId: started.taskRunId };
    },
    onSuccess: (result) => {
      if (result && 'status' in result && result.status === 'running') {
        setDetectHint('检测仍在后台进行，完成后刷新列表即可看到结果');
        return;
      }
      setDetectHint('检测完成');
      qc.invalidateQueries({ queryKey: ['alerts'] });
    },
    onError: (err) => {
      setDetectHint(err instanceof Error ? err.message : '检测失败');
    },
  });

  const resolve = useMutation({
    mutationFn: (id: string) => api.resolveAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }),
  });

  useEffect(() => {
    setPage(1);
  }, [productScope, view, grain, suggestOrder, suggestShip]);

  const setRecommendParam = (key: 'suggestOrder' | 'suggestShip', next: RecommendFilterValue) => {
    const nextParams = new URLSearchParams(params);
    if (next) nextParams.set(key, next);
    else nextParams.delete(key);
    setParams(nextParams);
  };

  if (isLoading || !data) return <p className="text-text-sub">加载中...</p>;

  const alerts = data.items;

  const exportCsv = async () => {
    setExporting(true);
    try {
      const pageSize = 100;
      const all: typeof alerts = [];
      let pageNum = 1;
      let total = Number.POSITIVE_INFINITY;
      while (all.length < total) {
        const batch = await api.getAlerts({
          page: pageNum,
          pageSize,
          q: appliedKeyword || undefined,
          resolved: 'open',
          productScope,
          view: listView,
          grain,
          suggestOrder: suggestOrder || undefined,
          suggestShip: suggestShip || undefined,
        });
        total = batch.total;
        all.push(...batch.items);
        if (!batch.items.length) break;
        pageNum += 1;
      }
      downloadAlertListCsv(all, grain);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader title={scene?.label ?? '库存概览'}>
        {scene ? (
            <Link to={grain === 'sku' ? '/inventory/alerts?grain=sku' : '/inventory/alerts'} className="text-sm text-primary hover:underline">
            查看全部
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => runAlert.mutate()} disabled={runAlert.isPending}>
            {runAlert.isPending ? '检测中...' : '手动触发检测'}
          </Button>
          {detectHint ? <span className="text-xs text-text-sub">{detectHint}</span> : null}
        </div>
      </PageHeader>

      <p className="text-sm text-text-sub">
        {scene?.hint ?? '确定性缺货和发货按确定断货日，不含本地库存和无日期在途。下单、健康、超备和滞销的可售天数含本地库存。发货档按应发统计。'}
      </p>
      <ProductScopeSwitch />
      <div className="flex flex-wrap gap-2">
        <Button
          variant={grain === 'sku' ? 'default' : 'outline'}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.set('grain', 'sku');
            setParams(next);
          }}
        >
          SKU 全网
        </Button>
        <Button
          variant={grain === 'warehouse' ? 'default' : 'outline'}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.delete('grain');
            setParams(next);
          }}
        >
          SKU × 仓库
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {INVENTORY_RISK_SCENES.map((item) => {
          const value = summary.data?.[item.view] ?? 0;
          const active = item.view === view;
          return (
            <Link key={item.view} to={grain === 'sku' ? `${item.href}&grain=sku` : item.href}>
              <Card className={cn('h-full shadow-card transition-shadow hover:shadow-md', (value > 0 || active) && 'border-primary/40', active && 'bg-muted/40')}>
                <CardContent className="py-4">
                  <p className="text-sm text-text-sub">{item.label}</p>
                  <p className={cn('mt-1 font-mono text-2xl font-semibold', value > 0 ? 'text-primary' : 'text-text-main')}>
                    {summary.isLoading ? '—' : value}
                  </p>
                  <p className="mt-1 text-xs text-text-sub">{item.hint}</p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle>
            库存概览
            {data.openCount > 0 && (
              <span className="ml-2 text-sm font-normal text-text-sub">
                （{data.openCount.toLocaleString()} {grain === 'sku' ? '个 SKU' : '条'}待处理）
              </span>
            )}
          </CardTitle>
          <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={() => void exportCsv()}>
            {exporting ? '导出中…' : '导出 CSV'}
          </Button>
        </CardHeader>
        <CardContent>
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="SKU 编码 / 名称"
          />
          <div className="mb-3 flex flex-wrap gap-4">
            <RecommendFilterGroup
              label="建议下单"
              value={suggestOrder}
              onChange={(next) => setRecommendParam('suggestOrder', next)}
            />
            <RecommendFilterGroup
              label="建议发货"
              value={suggestShip}
              onChange={(next) => setRecommendParam('suggestShip', next)}
            />
          </div>
          <details className="mb-3 text-xs text-text-hint">
            <summary className="cursor-pointer select-none text-text-sub hover:text-text-main">口径说明（点击展开）</summary>
            <p className="mt-2 leading-relaxed">
              {grain === 'sku'
                ? 'SKU 全网：分母为可规划 SKU，不限于本轮预警快照。库存数量来自飞书周转。可售天数和预计断货优先用已发布销售预测，从今天起按每天所属月份逐日扣减。没有已发布预测时才用周转「本月预测日均」；日均为空按 0 计，有库存时覆盖封顶 9999 天（进确定性滞销）。近7/14/30天销量取自周转「7天销量」「14天销量」「30天销量」，单格为 7/14/30。确定性缺货/发货档按「在库+在途」可售与海运交期比较，与上方卡片分档一致。'
                : 'SKU × 仓库：分档按本仓确定断货日（左侧「天数」）。右侧「全网合计·在库+在途」为 SKU 汇总，可长于本仓；本仓已确定性缺货时仍可能看到全网在库+在途大于 45 天。'}
            </p>
          </details>
          {grain === 'sku' ? (
            <SkuNetworkTable alerts={alerts} />
          ) : (
            <WarehouseAlertTable alerts={alerts} resolve={(id) => resolve.mutate(id)} />
          )}
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

type AlertItem = Awaited<ReturnType<typeof api.getAlerts>>['items'][number];

function DaysCell({ value }: { value: number | null | undefined }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-text-hint">—</span>;
  return <>{`${Math.round(value)}天`}</>;
}

function SkuNetworkTable({ alerts }: { alerts: AlertItem[] }) {
  return (
    <div className={alertTableWrap}>
      <table className="w-full min-w-[1180px] border-collapse text-sm">
        <thead className="sticky top-0 z-30 bg-muted text-text-sub">
          <tr className="border-b border-border">
            <th rowSpan={2} className={cn(stickySkuTh, 'align-bottom text-left')}>
              SKU
            </th>
            <th rowSpan={2} className={cn(alertTh, 'align-bottom text-right')} title="周转 7/14/30 天销量">
              近7/14/30天
            </th>
            <th rowSpan={2} className={cn(alertTh, 'align-bottom')}>
              等级
            </th>
            <th rowSpan={2} className={cn(alertTh, 'align-bottom text-left')}>
              分类
            </th>
            <th colSpan={3} className={alertThGroup}>
              库存
            </th>
            <th colSpan={3} className={cn(alertThGroup, 'bg-card/80')}>
              可售
            </th>
            <th colSpan={3} className={cn(alertThGroup, 'bg-highlight-warm/50')}>
              需求
            </th>
            <th colSpan={3} className={cn(alertThGroup, 'bg-highlight-warm/70')}>
              缺口
            </th>
            <th colSpan={3} className={cn(alertThGroup, 'bg-card/80')} title="数量为补到 150 天仍缺的件数">
              建议下单
            </th>
            <th colSpan={3} className={cn(alertThGroup, 'bg-card/80')} title="只扣海外在库与窗口内确定在途">
              建议发货
            </th>
          </tr>
          <tr className="border-b border-border text-text-sub">
            <th className={alertThSub}>本地</th>
            <th className={alertThSub}>在库</th>
            <th className={alertThSub}>在途</th>
            <th className={cn(alertThSub, 'bg-card/80')}>含本地</th>
            <th className={cn(alertThSub, 'bg-card/80')} title="在库 + 在途，按月预测逐日扣，不含本地">
              在库+在途
            </th>
            <th className={cn(alertThSub, 'bg-card/80')}>预计断货</th>
            <th className={cn(alertThSub, 'bg-highlight-warm/40')}>150d</th>
            <th className={cn(alertThSub, 'bg-highlight-warm/40')}>120d</th>
            <th className={cn(alertThSub, 'bg-highlight-warm/40')}>90d</th>
            <th className={cn(alertThSub, 'bg-highlight-warm/55')} title="未来90天需求 − 在库 − 在途 − 本地">
              90d
            </th>
            <th className={cn(alertThSub, 'bg-highlight-warm/55')} title="未来120天需求 − 在库 − 在途 − 本地">
              120d
            </th>
            <th className={cn(alertThSub, 'bg-highlight-warm/55')} title="未来150天需求 − 在库 − 在途 − 本地">
              150d
            </th>
            <th className={cn(alertThSub, 'bg-card/80')}>是否</th>
            <th className={cn(alertThSub, 'bg-card/80')} title="最晚下单日；需今天就下则显示立即">
              下单日期
            </th>
            <th className={cn(alertThSub, 'bg-card/80')}>下单数量</th>
            <th className={cn(alertThSub, 'bg-card/80')}>是否</th>
            <th className={cn(alertThSub, 'bg-card/80')} title="最晚开船日；7 天内必须开则显示立即">
              发货日期
            </th>
            <th className={cn(alertThSub, 'bg-card/80')}>发货数量</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => {
            const orderRec = orderRecommendationFields(a);
            const shipRec = shipRecommendationFields(a);
            return (
            <tr key={a.skuId} className={alertTr}>
              <td className={stickySkuTd}>{a.skuCode}</td>
              <td className="p-2 text-right">
                <SalesWindowCell d7={a.turnoverSales7d} d14={a.turnoverSales14d} d30={a.turnoverSales30d} />
              </td>
              <td className="p-2 font-mono text-center">{a.level ? ALERT_LEVEL_LABEL[a.level] ?? a.level : '—'}</td>
              <td className="p-2">
                <CategoryCell
                  action={a.action}
                  hasShippableLots={a.hasShippableLots}
                  hasUnallocatedLocal={a.hasUnallocatedLocal}
                />
              </td>
              <td className={alertTdNum}>
                <QtyCell value={a.networkLocalQty} />
              </td>
              <td className={alertTdNum}>
                <QtyCell value={a.networkOverseasQty} />
              </td>
              <td className={alertTdNum}>
                <QtyCell value={a.networkInTransitQty} />
              </td>
              <td className={cn(alertTdNum, 'bg-muted/20')}>
                <DaysCell value={a.networkBandDays} />
              </td>
              <td className={cn(alertTdNum, 'bg-muted/20')}>
                <DaysCell value={a.networkOnHandTransitDays} />
              </td>
              <td className={cn(alertTdNum, 'bg-muted/20 font-mono text-xs')}>
                <DateCell value={a.networkStockoutDate} />
              </td>
              <td className={cn(alertTdNum, 'bg-highlight-warm/25 text-text-sub')}>
                <QtyCell value={a.demand150} />
              </td>
              <td className={cn(alertTdNum, 'bg-highlight-warm/25 text-text-sub')}>
                <QtyCell value={a.demand120} />
              </td>
              <td className={cn(alertTdNum, 'bg-highlight-warm/25 text-text-sub')}>
                <QtyCell value={a.demand90} />
              </td>
              <td className={cn(alertTdNum, 'bg-highlight-warm/35')}>
                <GapCell value={a.gap90} covered={a.orderWindowCovered} />
              </td>
              <td className={cn(alertTdNum, 'bg-highlight-warm/35')}>
                <GapCell value={a.gap120} covered={a.orderWindowCovered} />
              </td>
              <td className={cn(alertTdNum, 'bg-highlight-warm/35')}>
                <GapCell value={a.gap150} covered={a.orderWindowCovered} />
              </td>
              <RecommendationCells rec={orderRec} />
              <RecommendationCells rec={shipRec} />
            </tr>
          );
          })}
          {!alerts.length && (
            <tr>
              <td colSpan={22} className="p-4 text-center text-text-hint">
                暂无记录
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function WarehouseAlertTable({ alerts, resolve }: { alerts: AlertItem[]; resolve: (id: string) => void }) {
  return (
    <div className={alertTableWrap}>
      <table className="w-full min-w-[1400px] border-collapse text-sm">
        <thead className="sticky top-0 z-30 bg-muted">
          <tr className="border-b border-border text-left text-text-sub">
            <th rowSpan={2} className={cn(stickySkuTh, 'align-bottom text-left')}>
              SKU
            </th>
            <th rowSpan={2} className="p-2 align-bottom font-normal" title="周转 7/14/30 天销量">
              近7/14/30天
            </th>
            <th rowSpan={2} className="p-2 align-bottom font-normal">仓库</th>
            <th rowSpan={2} className="p-2 align-bottom font-normal">等级</th>
            <th rowSpan={2} className="p-2 align-bottom font-normal">分类</th>
            <th rowSpan={2} className="p-2 align-bottom font-normal">原因</th>
            <th rowSpan={2} className="p-2 align-bottom font-normal">天数</th>
            <th colSpan={9} className="border-l border-border p-2 text-center font-medium text-text-main">
              本仓
              <div className="text-[11px] font-normal text-text-hint">与左侧天数同一口径</div>
            </th>
            <th colSpan={7} className="border-l border-border bg-highlight-warm/70 p-2 text-center font-medium text-text-main">
              全网合计
              <div className="text-[11px] font-normal text-text-sub">含本地，与全网天数同一口径</div>
            </th>
            <th rowSpan={2} className="p-2 align-bottom font-normal">操作</th>
          </tr>
          <tr className="border-b border-border text-left text-text-sub">
            <th className="border-l border-border p-2 font-normal">本地</th>
            <th className="p-2 font-normal">在库</th>
            <th className="p-2 font-normal">在途</th>
            <th className="p-2 font-normal" title="海外在库加上有上架日的在途，按确定断货日">在库可售</th>
            <th className="p-2 font-normal" title="在途件数 ÷ 本仓日均。上架日未定，按件数粗算">在途可售</th>
            <th className="p-2 font-normal" title="在库 + 在途件数 ÷ 本仓日均，不含本地">在库在途可售</th>
            <th className="p-2 font-normal" title="没有上架日，或上架日是估算">在途未定</th>
            <th className="p-2 font-normal">未来需求</th>
            <th className="p-2 font-normal">预计缺货</th>
            <th className="border-l border-border bg-highlight-warm/70 p-2 font-normal">天数</th>
            <th className="bg-highlight-warm/70 p-2 font-normal" title="全网在库 + 在途，按月预测逐日扣，不含本地">在库在途可售</th>
            <th className="bg-highlight-warm/70 p-2 font-normal">本地</th>
            <th className="bg-highlight-warm/70 p-2 font-normal">在库</th>
            <th className="bg-highlight-warm/70 p-2 font-normal">在途</th>
            <th className="bg-highlight-warm/70 p-2 font-normal">未来需求</th>
            <th className="bg-highlight-warm/70 p-2 font-normal">预计缺货</th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id} className={alertTr}>
              <td className={stickySkuTd}>{a.skuCode}</td>
              <td className="p-2 text-right">
                <SalesWindowCell d7={a.turnoverSales7d} d14={a.turnoverSales14d} d30={a.turnoverSales30d} />
              </td>
              <td className="p-2 font-mono text-text-sub">{a.warehouseCode ?? '—'}</td>
              <td className="p-2 font-mono">{a.level ? ALERT_LEVEL_LABEL[a.level] ?? a.level : '—'}</td>
              <td className="p-2">
                <CategoryCell
                  action={a.action}
                  hasShippableLots={a.hasShippableLots}
                  hasUnallocatedLocal={a.hasUnallocatedLocal}
                />
              </td>
              <td className="p-2 text-text-sub">
                {a.priceReason ? PRICE_REASON_LABEL[a.priceReason] ?? a.priceReason : '—'}
              </td>
              <td className="p-2 font-numeric"><DaysCell value={a.bandDays} /></td>
              <td className="border-l border-border p-2 font-numeric"><QtyCell value={a.localQty} /></td>
              <td className="p-2 font-numeric"><QtyCell value={a.overseasQty} /></td>
              <td className="p-2 font-numeric"><QtyCell value={a.inTransitQty} /></td>
              <td className="p-2 font-numeric"><DaysCell value={a.onHandCoverageDays} /></td>
              <td className="p-2 font-numeric"><DaysCell value={a.inTransitCoverageDays} /></td>
              <td className="p-2 font-numeric"><DaysCell value={a.warehouseOnHandTransitDays} /></td>
              <td className="p-2 font-numeric"><QtyCell value={a.inTransitUndatedQty} /></td>
              <td className="p-2 font-numeric text-primary"><QtyCell value={a.futureNeedQty} /></td>
              <td className="p-2 font-mono text-xs"><DateCell value={a.projectedStockoutDate} /></td>
              <td className="border-l border-border bg-highlight-warm/40 p-2 font-numeric"><DaysCell value={a.networkBandDays} /></td>
              <td className="bg-highlight-warm/40 p-2 font-numeric"><DaysCell value={a.networkOnHandTransitDays} /></td>
              <td className="bg-highlight-warm/40 p-2 font-numeric text-text-sub"><QtyCell value={a.networkLocalQty} /></td>
              <td className="bg-highlight-warm/40 p-2 font-numeric text-text-sub"><QtyCell value={a.networkOverseasQty} /></td>
              <td className="bg-highlight-warm/40 p-2 font-numeric text-text-sub"><QtyCell value={a.networkInTransitQty} /></td>
              <td className="bg-highlight-warm/40 p-2 font-numeric text-text-sub"><QtyCell value={a.networkFutureNeedQty} /></td>
              <td className="bg-highlight-warm/40 p-2 font-mono text-xs text-text-sub"><DateCell value={a.networkStockoutDate} /></td>
              <td className="space-x-1 whitespace-nowrap p-2">
                {!a.isResolved && (
                  <>
                    {(a.action === 'ship_urgent' || a.action === 'ship' || (a.action === 'stockout_imminent' && a.hasShippableLots)) ? (
                      <>
                        <Link to={`/inventory/planning/${a.skuId}${a.warehouseCode ? `?warehouse=${encodeURIComponent(a.warehouseCode)}` : ''}`} className="text-xs text-primary hover:underline">时间轴</Link>
                        <Link to="/pmc/shipments" className="text-xs text-primary hover:underline">发运</Link>
                      </>
                    ) : null}
                    {a.action === 'order_tight' || a.action === 'order' ? (
                      <>
                        <Link to={`/pmc/suggestions?sku=${encodeURIComponent(a.skuCode)}`} className="text-xs text-primary hover:underline">补货建议</Link>
                        <Link to={`/inventory/planning/${a.skuId}${a.warehouseCode ? `?warehouse=${encodeURIComponent(a.warehouseCode)}` : ''}`} className="text-xs text-primary hover:underline">时间轴</Link>
                      </>
                    ) : null}
                    {isStockoutRiskView(a.action) || a.action === 'overstock' || a.action === 'confirmed_slow' || a.action === 'healthy' || a.action === 'mild_overstock' ? (
                      <Link to={`/inventory/planning/${a.skuId}`} className="text-xs text-primary hover:underline">规划</Link>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => resolve(a.id)}>标记已处理</Button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {!alerts.length && (
            <tr>
              <td colSpan={24} className="p-4 text-center text-text-hint">暂无记录</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
