import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { DEMAND_PLAN_SCOPE_NOTICE } from '@/lib/product-scope-copy';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { DemandPlanDataExplorer } from '@/components/DemandPlanDataExplorer';
import {
  DemandPlanSkuDetailDrawer,
  type DemandPlanSkuClickInput,
} from '@/components/DemandPlanSkuDetailDrawer';
import { DemandPlanAccuracyPanel } from '@/components/DemandPlanAccuracyPanel';
import { DemandPlanReviewSummaryCard } from '@/components/DemandPlanReviewSummaryCard';
import { DemandPlanVersionStatusBadge } from '@/components/DemandPlanVersionStatusBadge';
import { mutationErrorMessage } from '@/lib/forecast-version-utils';
import {
  buildDemandPlanVersionDetailSearch,
  DEMAND_PLAN_REPLENISHMENT_DEFER_NOTICE,
  demandPlanPeriodGrain,
  formatDemandPlanHorizon,
  formatDemandPlanProjectGroup,
  formatDemandPlanVersionTitle,
} from '@/lib/demand-plan-utils';

type DetailView = 'data' | 'review' | 'accuracy';

const VIEW_LABEL: Record<DetailView, string> = {
  data: '数据明细',
  review: '复核与发布',
  accuracy: '准确度复盘',
};

const LIST_PAGE_SIZE = 20;

function isViewAllowed(view: DetailView, status: string, grain: 'week' | 'month'): boolean {
  if (view === 'data') return true;
  if (view === 'review') return status === 'draft';
  if (view === 'accuracy') return grain === 'week';
  return false;
}

export function DemandPlanDetailPage() {
  const { id: versionId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedSku, setSelectedSku] = useState<DemandPlanSkuClickInput | null>(null);
  const [calibrationImportOpen, setCalibrationImportOpen] = useState(
    () => searchParams.get('calibrationImport') === '1',
  );

  useEffect(() => {
    if (searchParams.get('calibrationImport') !== '1') return;
    setCalibrationImportOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete('calibrationImport');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const { data: detailMeta, isLoading, isError } = useQuery({
    queryKey: ['demand-plan-version', versionId],
    queryFn: () => api.getDemandPlan(versionId, { view: 'wide', page: 1, pageSize: 1 }),
    enabled: Boolean(versionId),
  });

  const version = detailMeta?.version;
  const stats = detailMeta?.stats;
  const adoption = detailMeta?.adoption;
  const champion = detailMeta?.championForecastVersion;
  const grain = version ? demandPlanPeriodGrain(version) : 'week';

  const defaultView = useMemo<DetailView>(() => {
    if (!version) return 'data';
    if (version.status === 'draft') return 'review';
    return 'data';
  }, [version]);

  const requestedView = searchParams.get('view') as DetailView | null;
  const activeView =
    requestedView && version && isViewAllowed(requestedView, version.status, grain)
      ? requestedView
      : defaultView;

  useEffect(() => {
    if (!version) return;
    if (requestedView && isViewAllowed(requestedView, version.status, grain)) return;
    if (requestedView && !isViewAllowed(requestedView, version.status, grain)) {
      setSearchParams(buildDemandPlanVersionDetailSearch({ view: defaultView }), { replace: true });
    }
  }, [version, requestedView, defaultView, grain, setSearchParams]);

  const setActiveView = (view: DetailView) => {
    setSearchParams(buildDemandPlanVersionDetailSearch({ view }), { replace: false });
  };

  const publish = useMutation({
    mutationFn: (adopt: boolean) => api.publishDemandPlan(versionId, { adopt }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demand-plan-versions'] });
      qc.invalidateQueries({ queryKey: ['demand-plan-version', versionId] });
      qc.invalidateQueries({ queryKey: ['demand-plan-data', versionId] });
      setSearchParams(buildDemandPlanVersionDetailSearch({ view: 'data' }));
    },
  });

  const adoptWeekly = useMutation({
    mutationFn: () => api.adoptDemandPlan(versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demand-plan-versions'] });
      qc.invalidateQueries({ queryKey: ['demand-plan-version', versionId] });
    },
  });

  const adoptMonthly = useMutation({
    mutationFn: () =>
      api.adoptForecast({
        projectGroup: version!.projectGroup,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demand-plan-versions'] });
      qc.invalidateQueries({ queryKey: ['demand-plan-version', versionId] });
    },
  });

  const archive = useMutation({
    mutationFn: () => api.archiveDemandPlan(versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['demand-plan-versions'] });
      navigate('/data/demand-plan');
    },
  });

  const availableViews = useMemo(() => {
    if (!version) return ['data'] as DetailView[];
    const views: DetailView[] = ['data'];
    if (version.status === 'draft') views.push('review');
    if (grain === 'week') views.push('accuracy');
    return views;
  }, [version, grain]);

  if (isLoading) return <p className="text-text-sub">加载中…</p>;
  if (isError || !version) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">版本不存在或加载失败。</p>
        <Link to="/data/demand-plan" className="text-primary hover:underline">
          返回版本列表
        </Link>
      </div>
    );
  }

  const showReviewActions = version.status === 'draft';
  const showDataExplorer = activeView === 'data' || activeView === 'review';
  const periodSummary =
    grain === 'week'
      ? formatDemandPlanHorizon(version)
      : `${version.startMonth ?? '—'} · ${version.horizonMonths ?? 6} 月`;

  const handleSkuClick = (input: DemandPlanSkuClickInput) => {
    if (grain === 'month') {
      window.alert('月粒度需求计划请使用「销量预测」查看逐月因子与校准；周因子抽屉仅适用于周预测版本。');
      return;
    }
    setSelectedSku(input);
  };

  return (
    <div className="space-y-6">
      <PageHeader title={formatDemandPlanVersionTitle(version.versionNo, version.versionName)}>
        <div className="flex flex-wrap items-center gap-2">
          <DemandPlanVersionStatusBadge status={version.status} />
          <span className="text-xs text-text-sub">{formatDemandPlanProjectGroup(version.projectGroup)}</span>
          <span className="font-mono text-xs text-text-sub">{periodSummary}</span>
          {version.status === 'pilot_published' && (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-text-sub">
              已发布
            </span>
          )}
          <Link to="/data/demand-plan" className="text-sm text-primary hover:underline">
            返回列表
          </Link>
        </div>
      </PageHeader>

      <Card className="border-border/80">
        <CardContent className="space-y-2 py-3 text-sm text-text-sub">
          <p className="text-text-main">{DEMAND_PLAN_SCOPE_NOTICE}</p>
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            {DEMAND_PLAN_REPLENISHMENT_DEFER_NOTICE}
          </p>
          <p>
            周度销量预测：默认内联 V4.1 与月销量预测同算法生成（不依赖月版本发布）；Champion 月版本仅作可选对照。校准：分平台导出校准表改数后导入（按月形状反算全平台合计），或明细/抽屉直接校准「全平台」行。
            {stats && stats.skuTotal > 0 ? (
              <span className="ml-2 font-numeric text-text-main">
                · {stats.skuTotal.toLocaleString()} SKU / {stats.rowTotal.toLocaleString()} 计划行
              </span>
            ) : null}
          </p>
          {champion ? (
            <p className="text-xs">
              Champion 月预测：
              <span className="ml-1 font-mono text-text-main">
                {champion.versionNo}
                {champion.versionName && champion.versionName !== champion.versionNo
                  ? ` · ${champion.versionName}`
                  : ''}
              </span>
            </p>
          ) : (
            <p className="text-xs">Champion 月预测：暂无已发布版本可绑定</p>
          )}
          {detailMeta?.periods.length ? (
            <p className="text-xs">
              {grain === 'week' ? '周次' : '月份'}：{detailMeta.periods.join('、')}
            </p>
          ) : null}
          {adoption ? (
            <p className="text-xs">
              采用登记：
              {adoption.source === 'demand_plan'
                ? `周预测（${version.versionNo}）· 补货计算暂未切换`
                : '月预测 · 补货计算仍以此为准'}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        {availableViews.map((view) => (
          <Button
            key={view}
            variant={activeView === view ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveView(view)}
          >
            {VIEW_LABEL[view]}
          </Button>
        ))}
      </div>

      {activeView === 'review' && showReviewActions && (
        <div className="space-y-4">
          <DemandPlanReviewSummaryCard
            versionId={versionId}
            onOpenT99={() => setActiveView('data')}
            onOpenAccuracy={() => setActiveView('accuracy')}
          />
          <Card>
            <CardContent className="space-y-4 py-4">
              <p className="text-xs text-text-sub">
                「发布并采用」仅登记采用意图，{DEMAND_PLAN_REPLENISHMENT_DEFER_NOTICE}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate(false)}>
                  {publish.isPending ? '发布中…' : '发布草稿'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={publish.isPending}
                  title="采用仅登记意图，暂不改变补货计算"
                  onClick={() => publish.mutate(true)}
                >
                  发布并采用
                </Button>
                <Button size="sm" variant="outline" onClick={() => setActiveView('data')}>
                  查看全部数据明细
                </Button>
                {version.status !== 'archived' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    disabled={archive.isPending}
                    onClick={() => {
                      if (window.confirm(`确定归档「${version.versionName || version.versionNo}」？`)) {
                        archive.mutate();
                      }
                    }}
                  >
                    {archive.isPending ? '归档中…' : '归档'}
                  </Button>
                ) : null}
              </div>
              {publish.isError && (
                <pre className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {mutationErrorMessage(publish.error)}
                </pre>
              )}
              {archive.isError && (
                <p className="text-sm text-destructive">{mutationErrorMessage(archive.error)}</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {version.status === 'pilot_published' && (
        <Card>
          <CardContent className="space-y-3 py-4">
            <p className="text-xs text-text-sub">{DEMAND_PLAN_REPLENISHMENT_DEFER_NOTICE}</p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={adoptWeekly.isPending || adoption?.demandPlanVersionId === versionId}
                onClick={() => adoptWeekly.mutate()}
              >
                {adoption?.demandPlanVersionId === versionId ? '已登记采用周预测' : '采用周预测'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={adoptMonthly.isPending}
                onClick={() => adoptMonthly.mutate()}
              >
                改登月预测
              </Button>
              {(adoptWeekly.isError || adoptMonthly.isError) && (
                <p className="text-sm text-destructive">
                  {mutationErrorMessage(adoptWeekly.error ?? adoptMonthly.error)}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {activeView === 'accuracy' && grain === 'week' ? (
        <DemandPlanAccuracyPanel versionId={versionId} />
      ) : null}

      {showDataExplorer && (
        <DemandPlanDataExplorer
          active
          fixedVersionId={versionId}
          fixedVersionLabel={version.versionNo}
          grain={grain}
          editable={version.status === 'draft'}
          calibrationImportEnabled={version.status === 'draft' && grain === 'week'}
          showPendingCalibrationShortcut={
            grain === 'week' && (version.status === 'draft' || activeView === 'review')
          }
          initialCalibrationImportOpen={
            calibrationImportOpen && version.status === 'draft' && grain === 'week'
          }
          pageSize={LIST_PAGE_SIZE}
          title={activeView === 'review' ? '复核数据矩阵' : '周预测数据明细'}
          description={
            activeView === 'review'
              ? '宽表纵览 26 周生效日均；可用「待校准（T99）」筛选。长表可改人工日均；分平台导出校准表改数后导入将反算合计。发布冻结周预测版本（补货暂未切换）。'
              : '宽表为 SKU × 周次矩阵，长表为明细。筛选与导出与当前查询一致；草稿可导入校准或长表改数。'
          }
          onSkuClick={handleSkuClick}
        />
      )}

      <DemandPlanSkuDetailDrawer
        versionId={versionId}
        selectedSku={selectedSku}
        onClose={() => setSelectedSku(null)}
        planCalibrationEditable={
          grain === 'week' && version.status === 'draft' && (activeView === 'data' || activeView === 'review')
        }
      />
    </div>
  );
}
