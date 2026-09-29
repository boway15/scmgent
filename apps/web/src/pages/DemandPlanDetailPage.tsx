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
import { DemandPlanVersionStatusBadge } from '@/components/DemandPlanVersionStatusBadge';
import { mutationErrorMessage } from '@/lib/forecast-version-utils';
import {
  buildDemandPlanVersionDetailSearch,
  demandPlanPeriodGrain,
  formatDemandPlanHorizon,
  formatDemandPlanProjectGroup,
  formatDemandPlanVersionTitle,
} from '@/lib/demand-plan-utils';

type DetailView = 'data' | 'review';

const VIEW_LABEL: Record<DetailView, string> = {
  data: '数据明细',
  review: '复核与发布',
};

const LIST_PAGE_SIZE = 20;

function isViewAllowed(view: DetailView, status: string): boolean {
  if (view === 'data') return true;
  if (view === 'review') return status === 'draft';
  return false;
}

export function DemandPlanDetailPage() {
  const { id: versionId = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedSku, setSelectedSku] = useState<DemandPlanSkuClickInput | null>(null);

  const { data: detailMeta, isLoading, isError } = useQuery({
    queryKey: ['demand-plan-version', versionId],
    queryFn: () => api.getDemandPlan(versionId, { view: 'wide', page: 1, pageSize: 1 }),
    enabled: Boolean(versionId),
  });

  const version = detailMeta?.version;
  const stats = detailMeta?.stats;
  const adoption = detailMeta?.adoption;
  const grain = version ? demandPlanPeriodGrain(version) : 'week';

  const defaultView = useMemo<DetailView>(() => {
    if (!version) return 'data';
    if (version.status === 'draft') return 'review';
    return 'data';
  }, [version]);

  const requestedView = searchParams.get('view') as DetailView | null;
  const activeView =
    requestedView && version && isViewAllowed(requestedView, version.status)
      ? requestedView
      : defaultView;

  useEffect(() => {
    if (!version) return;
    if (requestedView && isViewAllowed(requestedView, version.status)) return;
    if (requestedView && !isViewAllowed(requestedView, version.status)) {
      setSearchParams(buildDemandPlanVersionDetailSearch({ view: defaultView }), { replace: true });
    }
  }, [version, requestedView, defaultView, setSearchParams]);

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
    return views;
  }, [version]);

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
        <CardContent className="py-3 text-sm text-text-sub">
          <p className="mb-2 text-text-main">{DEMAND_PLAN_SCOPE_NOTICE}</p>
          <p>
            近 90 天销量反推周需求为主，月预测仅作季节形状；与销量预测模块独立。
            {stats && stats.skuTotal > 0 ? (
              <span className="ml-2 font-numeric text-text-main">
                · {stats.skuTotal.toLocaleString()} SKU / {stats.rowTotal.toLocaleString()} 计划行
              </span>
            ) : null}
          </p>
          {detailMeta?.periods.length ? (
            <p className="mt-1 text-xs">
              {grain === 'week' ? '周次' : '月份'}：{detailMeta.periods.join('、')}
            </p>
          ) : null}
          {adoption ? (
            <p className="mt-1 text-xs">
              补货口径：
              {adoption.source === 'demand_plan'
                ? `周计划（${version.versionNo}）`
                : '月预测'}
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
        <Card>
          <CardContent className="space-y-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" disabled={publish.isPending} onClick={() => publish.mutate(false)}>
                {publish.isPending ? '发布中…' : '发布草稿'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={publish.isPending}
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
      )}

      {version.status === 'pilot_published' && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-4">
            <Button
              size="sm"
              variant="outline"
              disabled={adoptWeekly.isPending || adoption?.demandPlanVersionId === versionId}
              onClick={() => adoptWeekly.mutate()}
            >
              {adoption?.demandPlanVersionId === versionId ? '已采用周计划' : '采用周计划'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={adoptMonthly.isPending}
              onClick={() => adoptMonthly.mutate()}
            >
              改吃月预测
            </Button>
            {(adoptWeekly.isError || adoptMonthly.isError) && (
              <p className="text-sm text-destructive">
                {mutationErrorMessage(adoptWeekly.error ?? adoptMonthly.error)}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {showDataExplorer && (
        <DemandPlanDataExplorer
          active
          fixedVersionId={versionId}
          fixedVersionLabel={version.versionNo}
          grain={grain}
          editable={version.status === 'draft'}
          pageSize={LIST_PAGE_SIZE}
          title={activeView === 'review' ? '复核数据矩阵' : '计划数据明细'}
          description={
            activeView === 'review'
              ? '宽表纵览 26 周生效日均；长表可改人工日均（须填原因）。点击 SKU 查看主数据与销量预测详情。发布并采用后该项目组补货吃周计划。'
              : '宽表为 SKU × 周次矩阵，长表为 SKU × 周期明细。点击 SKU 查看主数据与销量预测详情；草稿请在长表修改人工值。'
          }
          onSkuClick={setSelectedSku}
        />
      )}

      <DemandPlanSkuDetailDrawer
        versionId={versionId}
        selectedSku={selectedSku}
        onClose={() => setSelectedSku(null)}
      />
    </div>
  );
}
