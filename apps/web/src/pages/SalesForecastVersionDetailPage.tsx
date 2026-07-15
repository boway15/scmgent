import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ForecastDataExplorer } from '@/components/ForecastDataExplorer';
import { ForecastSkuDetailDrawer, type ForecastHorizonRow } from '@/components/ForecastSkuDetailDrawer';
import { ForecastAccuracyDiagnosticsPanel } from '@/components/ForecastAccuracyDiagnosticsPanel';
import { ForecastAccuracyMetricLabel } from '@/components/ForecastAccuracyMetricLabel';
import { WalkForwardMonthTierTable } from '@/components/WalkForwardMonthTierTable';
import { FORECAST_ACCURACY_METRICS_LEGEND_INTRO } from '@/lib/forecast-accuracy-metrics';
import { ForecastVersionStatusBadge } from '@/components/ForecastVersionStatusBadge';
import { computeWalkForwardAsOf } from '@/lib/forecast-walkforward-utils';
import { resolveHorizonPlatformScope } from '@/lib/forecast-horizon-meta';
import { formatForecastVersionTitle, mutationErrorMessage, buildForecastVersionDetailSearch, resolveForecastExplorerPlatform } from '@/lib/forecast-version-utils';
import { formatTierDisplayLabel } from '@/lib/forecast-labels';

type DetailView = 'data' | 'review' | 'accuracy';

const VIEW_LABEL: Record<DetailView, string> = {
  data: '数据明细',
  review: '复核与发布',
  accuracy: '准确率复盘',
};

const LIST_PAGE_SIZE = 20;

function isViewAllowed(view: DetailView, status: string): boolean {
  if (view === 'data') return true;
  if (view === 'review') return status === 'draft';
  if (view === 'accuracy') return status === 'published' || status === 'archived';
  return false;
}

export function SalesForecastVersionDetailPage() {
  const { versionId = '' } = useParams<{ versionId: string }>();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reviewSummary, setReviewSummary] = useState<string | null>(null);
  const [impactPreview, setImpactPreview] = useState<string | null>(null);
  const [selectedHorizonRow, setSelectedHorizonRow] = useState<ForecastHorizonRow | null>(null);
  const [selectedHorizonPlatform, setSelectedHorizonPlatform] = useState('ALL');
  const [accuracyPage, setAccuracyPage] = useState(1);
  const [accuracyBacktestMonths, setAccuracyBacktestMonths] = useState(6);
  const [walkForwardTier, setWalkForwardTier] = useState<'all' | 'core' | 'mid' | 'tail'>('all');
  const [walkForwardAccuracyVersionId, setWalkForwardAccuracyVersionId] = useState<string | null>(null);
  const [accuracyDraftTargetVersionId, setAccuracyDraftTargetVersionId] = useState('');
  const [accuracyExporting, setAccuracyExporting] = useState(false);
  const [listPageSize, setListPageSize] = useState(LIST_PAGE_SIZE);

  const { data: version, isLoading, isError } = useQuery({
    queryKey: ['sales-forecast-version', versionId],
    queryFn: () => api.getSalesForecastVersion(versionId),
    enabled: Boolean(versionId),
  });

  const { data: draftVersions = [] } = useQuery({
    queryKey: ['sales-forecast-versions', 'draft'],
    queryFn: () => api.getSalesForecastVersions({ status: 'draft' }),
    enabled: Boolean(versionId),
  });

  const latestDraftVersion = draftVersions[0];

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
      setSearchParams({ view: defaultView }, { replace: true });
    }
  }, [version, requestedView, defaultView, setSearchParams]);

  useEffect(() => {
    setAccuracyPage(1);
    const stored = sessionStorage.getItem(`wf-accuracy-version:${versionId}`);
    setWalkForwardAccuracyVersionId(stored || null);
  }, [versionId]);

  const accuracyListVersionId = walkForwardAccuracyVersionId ?? versionId;
  const viewingWalkForwardAccuracy =
    Boolean(walkForwardAccuracyVersionId) && walkForwardAccuracyVersionId !== versionId;

  const setActiveView = (view: DetailView) => {
    const next = new URLSearchParams(searchParams);
    next.set('view', view);
    setSearchParams(next);
  };

  const { data: versionSummary } = useQuery({
    queryKey: ['sales-forecast-version-summary', versionId],
    queryFn: () => api.getSalesForecastVersionSummary(versionId),
    enabled: Boolean(versionId),
  });

  const { data: platforms } = useQuery({
    queryKey: ['sales-platforms', 'all'],
    queryFn: () => api.getSalesPlatforms(),
  });

  const { data: accuracy } = useQuery({
    queryKey: ['sales-forecast-accuracy', accuracyListVersionId, accuracyPage, listPageSize],
    queryFn: () =>
      api.getSalesForecastAccuracy({
        versionId: accuracyListVersionId,
        page: accuracyPage,
        pageSize: listPageSize,
      }),
    enabled: activeView === 'accuracy' && Boolean(accuracyListVersionId),
  });

  const {
    data: accuracyDiagnostics,
    isLoading: accuracyDiagnosticsLoading,
    error: accuracyDiagnosticsError,
  } = useQuery({
    queryKey: ['sales-forecast-accuracy-diagnostics', accuracyListVersionId],
    queryFn: () =>
      api.getSalesForecastAccuracyDiagnostics({ versionId: accuracyListVersionId, limitTopErrors: 10 }),
    enabled: activeView === 'accuracy' && Boolean(accuracyListVersionId),
  });

  const impactPreviewMutation = useMutation({
    mutationFn: () => api.getSalesForecastImpactPreview(versionId),
    onMutate: () => setImpactPreview(null),
    onSuccess: (data) => setImpactPreview(data.summary),
  });

  const publishVersion = useMutation({
    mutationFn: () => api.publishSalesForecastVersion(versionId),
    onSuccess: () => {
      setImpactPreview(null);
      setReviewSummary(null);
      qc.invalidateQueries({ queryKey: ['sales-forecast-versions'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-version', versionId] });
      qc.invalidateQueries({ queryKey: ['sales-forecasts'] });
      setSearchParams({ view: 'data' });
    },
  });

  const reviewVersion = useMutation({
    mutationFn: () => api.getSalesForecastReviewSummary(versionId),
    onMutate: () => setReviewSummary(null),
    onSuccess: (data) => setReviewSummary(data.summary),
  });

  const accuracyBacktestMutation = useMutation({
    mutationFn: () =>
      api.backtestSalesForecastAccuracy({
        monthCount: accuracyBacktestMonths,
        versionId: accuracyDraftTargetVersionId || latestDraftVersion?.id || undefined,
        createReviewItems: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-review-items'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-version', versionId] });
    },
  });

  const walkForwardMutation = useMutation({
    mutationFn: () =>
      api.walkForwardSalesForecastAccuracy({
        asOf: computeWalkForwardAsOf(accuracyBacktestMonths),
        monthCount: accuracyBacktestMonths,
        station: version?.station?.trim() || undefined,
        platform: 'ALL',
        tierFilter: walkForwardTier === 'all' ? undefined : walkForwardTier,
        createReviewItems: false,
      }),
    onSuccess: async (data) => {
      setWalkForwardAccuracyVersionId(data.version.id);
      sessionStorage.setItem(`wf-accuracy-version:${versionId}`, data.version.id);
      setAccuracyPage(1);
      await qc.fetchQuery({
        queryKey: ['sales-forecast-accuracy', data.version.id, 1, listPageSize],
        queryFn: () =>
          api.getSalesForecastAccuracy({
            versionId: data.version.id,
            page: 1,
            pageSize: listPageSize,
          }),
      });
      qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy-summary'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy-diagnostics'] });
    },
  });

  const accuracyListItems =
    accuracy?.items?.length ? accuracy.items : (walkForwardMutation.data?.accuracyList?.items ?? []);
  const accuracyListTotal = accuracy?.total ?? walkForwardMutation.data?.accuracyList?.total ?? 0;

  const handleSkuClick = (row: ForecastHorizonRow, ctx?: { platform: string }) => {
    setSelectedHorizonRow(row);
    setSelectedHorizonPlatform(ctx?.platform ?? row.platform ?? 'ALL');
  };

  const availableViews = useMemo(() => {
    if (!version) return ['data'] as DetailView[];
    const views: DetailView[] = ['data'];
    if (version.status === 'draft') views.push('review');
    if (version.status === 'published' || version.status === 'archived') views.push('accuracy');
    return views;
  }, [version]);

  const initialExplorerPlatform = useMemo(
    () =>
      resolveForecastExplorerPlatform({
        urlPlatform: searchParams.get('platform'),
        generationPlatform: version?.generationPlatform,
        resolveScope: resolveHorizonPlatformScope,
      }),
    [searchParams, version?.generationPlatform],
  );
  if (isLoading) return <p className="text-text-sub">加载中…</p>;
  if (isError || !version) {
    return (
      <div className="space-y-4">
        <p className="text-destructive">版本不存在或加载失败。</p>
        <Link to="/data/forecast" className="text-primary hover:underline">
          返回版本列表
        </Link>
      </div>
    );
  }

  const showReviewActions = version.status === 'draft';
  const showDataExplorer = activeView === 'data' || activeView === 'review';

  return (
    <div className="space-y-6">
      <PageHeader title={formatForecastVersionTitle(version.versionNo, version.versionName)}>
        <div className="flex flex-wrap items-center gap-2">
          <ForecastVersionStatusBadge status={version.status} />
          {version.status === 'published' && (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-text-sub">
              已发布 · 同 SKU 冲突时以最新发布为准
            </span>
          )}
          <Link to="/data/forecast" className="text-sm text-primary hover:underline">
            返回列表
          </Link>
        </div>
      </PageHeader>

      {versionSummary && (
        <Card className="border-border/80">
          <CardContent className="py-3 text-sm text-text-sub">
            <p>
              {versionSummary.description}
              {version.stats.skuCount > 0 && (
                <span className="ml-2 font-numeric text-text-main">
                  · {version.stats.skuCount.toLocaleString()} SKU /{' '}
                  {version.stats.forecastRowCount.toLocaleString()} 预测行
                </span>
              )}
            </p>
            {versionSummary.monthLabels.length > 0 && (
              <p className="mt-1 text-xs">月份：{versionSummary.monthLabels.join('、')}</p>
            )}
          </CardContent>
        </Card>
      )}

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
              <Button size="sm" disabled={publishVersion.isPending} onClick={() => publishVersion.mutate()}>
                {publishVersion.isPending ? '发布中…' : '发布草稿'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  impactPreviewMutation.reset();
                  setImpactPreview(null);
                  impactPreviewMutation.mutate();
                }}
              >
                影响预览
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  reviewVersion.reset();
                  setReviewSummary(null);
                  reviewVersion.mutate();
                }}
              >
                AI 复核摘要
              </Button>
              <Button size="sm" variant="outline" onClick={() => setActiveView('data')}>
                查看全部数据明细
              </Button>
            </div>
            {publishVersion.isError && (
              <pre className="whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {mutationErrorMessage(publishVersion.error)}
              </pre>
            )}
            {impactPreviewMutation.isError && (
              <p className="text-sm text-destructive">{mutationErrorMessage(impactPreviewMutation.error)}</p>
            )}
            {reviewVersion.isError && (
              <p className="text-sm text-destructive">{mutationErrorMessage(reviewVersion.error)}</p>
            )}
            {impactPreview && (
              <div className="rounded-md border border-border bg-card p-3">
                <p className="text-sm font-medium text-text-main">发布影响预览</p>
                <pre className="mt-2 whitespace-pre-wrap text-sm text-text-sub">{impactPreview}</pre>
              </div>
            )}
            {reviewSummary && (
              <div className="rounded-md border border-border bg-card p-3">
                <p className="text-sm font-medium text-text-main">AI 复核摘要（只读，不修改预测值）</p>
                <pre className="mt-2 whitespace-pre-wrap text-sm text-text-sub">{reviewSummary}</pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {showDataExplorer && (
        <ForecastDataExplorer
          active
          fixedVersionId={versionId}
          fixedVersionLabel={version.versionNo}
          platforms={platforms}
          initialPlatform={initialExplorerPlatform}
          pageSize={listPageSize}
          showPendingCalibrationShortcut={activeView === 'review'}
          title={activeView === 'review' ? '复核数据矩阵' : '预测数据明细'}
          description={
            activeView === 'review'
              ? '常规商品与 T99 在同一矩阵展示；T99 系统预测为 0.00，悬停可见「待校准」。使用分层筛选或「待校准（T99）」快捷按钮定位未校准 SKU，点击 SKU 在抽屉中 AI 辅助或人工校准。'
              : '未来矩阵为预测日均，历史矩阵为销量折算实际日均。点击 SKU 查看因子与逐月详情。'
          }
          onSkuClick={handleSkuClick}
        />
      )}

      {activeView === 'accuracy' && (
        <>
          <ForecastAccuracyDiagnosticsPanel
            diagnostics={accuracyDiagnostics}
            isLoading={accuracyDiagnosticsLoading}
            error={accuracyDiagnosticsError}
          />
          <Card>
            <CardHeader>
              <CardTitle>预测准确率</CardTitle>
              <p className="text-sm text-text-sub">
                {viewingWalkForwardAccuracy
                  ? `走步影子版本 ${walkForwardMutation.data?.version.versionName ?? ''} 的逐月复盘（含 T4B / ghost）`
                  : `当前版本 ${version.versionNo} 的逐月复盘；需有对应月份实际销量。`}
                {FORECAST_ACCURACY_METRICS_LEGEND_INTRO} 下表为单月口径，悬停列名可看公式。
              </p>
              {viewingWalkForwardAccuracy && walkForwardMutation.data?.version.id && (
                <p className="text-sm text-primary">
                  列表已切换至走步影子版本，共 {accuracy?.total?.toLocaleString() ?? '…'} 条准确率记录。
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => {
                      setWalkForwardAccuracyVersionId(null);
                      sessionStorage.removeItem(`wf-accuracy-version:${versionId}`);
                      setAccuracyPage(1);
                    }}
                  >
                    恢复当前版本
                  </button>
                </p>
              )}
              {accuracy?.summary && (
                <pre className="mt-2 whitespace-pre-wrap text-sm text-text-sub">{accuracy.summary}</pre>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={24}
                  className="h-9 w-28"
                  value={accuracyBacktestMonths}
                  onChange={(e) => setAccuracyBacktestMonths(Number(e.target.value) || 6)}
                />
                <span className="text-sm text-text-sub">个月批量回测</span>
                <Button
                  variant="outline"
                  disabled={accuracyBacktestMutation.isPending}
                  onClick={() => accuracyBacktestMutation.mutate()}
                >
                  运行回测
                </Button>
                <select
                  className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  value={walkForwardTier}
                  onChange={(e) => setWalkForwardTier(e.target.value as typeof walkForwardTier)}
                >
                  <option value="all">分层：全量</option>
                  <option value="core">主力</option>
                  <option value="mid">腰部</option>
                  <option value="tail">长尾</option>
                </select>
                <Button
                  variant="outline"
                  disabled={walkForwardMutation.isPending}
                  onClick={() => walkForwardMutation.mutate()}
                >
                  {walkForwardMutation.isPending ? '走步回测中…' : '走步回测'}
                </Button>
                <Button
                  variant="outline"
                  disabled={accuracyExporting || !accuracyListVersionId || accuracyListTotal === 0}
                  onClick={async () => {
                    setAccuracyExporting(true);
                    try {
                      await api.exportSalesForecastAccuracy({
                        versionId: accuracyListVersionId,
                        groupBy: 'sku',
                      });
                    } finally {
                      setAccuracyExporting(false);
                    }
                  }}
                >
                  {accuracyExporting ? '导出中…' : '导出 SKU 汇总'}
                </Button>
                <Button
                  variant="outline"
                  disabled={accuracyExporting || !accuracyListVersionId || accuracyListTotal === 0}
                  onClick={async () => {
                    setAccuracyExporting(true);
                    try {
                      await api.exportSalesForecastAccuracy({ versionId: accuracyListVersionId });
                    } finally {
                      setAccuracyExporting(false);
                    }
                  }}
                >
                  {accuracyExporting ? '导出中…' : '导出 CSV'}
                </Button>
              </div>
              {walkForwardMutation.data?.summary && (
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm text-text-sub">
                  {walkForwardMutation.data.summary}
                </pre>
              )}
              {walkForwardMutation.data?.monthTierSummary && walkForwardMutation.data.monthTierSummary.length > 0 && (
                <WalkForwardMonthTierTable rows={walkForwardMutation.data.monthTierSummary} />
              )}
              {walkForwardMutation.isError && (
                <p className="text-sm text-destructive">{mutationErrorMessage(walkForwardMutation.error)}</p>
              )}
              {accuracyBacktestMutation.data?.summary && (
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm text-text-sub">
                  {accuracyBacktestMutation.data.summary}
                </pre>
              )}
              {accuracyBacktestMutation.isError && (
                <p className="text-sm text-destructive">{mutationErrorMessage(accuracyBacktestMutation.error)}</p>
              )}
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">SKU</th>
                    <th className="p-2 font-normal">商品分层</th>
                    <th className="p-2 font-normal">渠道</th>
                    <th className="p-2 font-normal">月份</th>
                    <th className="p-2 font-normal">预测日均</th>
                    <th className="p-2 font-normal">实际日均</th>
                    <th className="p-2 font-normal">
                      <ForecastAccuracyMetricLabel metric="rowMape" showShort />
                    </th>
                    <th className="p-2 font-normal">
                      <ForecastAccuracyMetricLabel metric="rowWmape" showShort />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {accuracyListItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-text-sub">
                        {walkForwardMutation.isPending
                          ? '走步回测进行中…'
                          : viewingWalkForwardAccuracy
                            ? '暂无准确率明细，请确认走步回测已完成且 KPI 可比行已写入。'
                            : '暂无准确率记录；可运行走步回测或批量回测后查看。'}
                      </td>
                    </tr>
                  ) : (
                    accuracyListItems.map((row) => (
                      <tr key={row.id} className="border-b border-border/60">
                        <td className="p-2">{row.skuCode}</td>
                        <td className="p-2 text-text-sub">
                          {formatTierDisplayLabel(row.profileSegment, null)}
                        </td>
                        <td className="p-2">{row.platform}</td>
                        <td className="p-2">{row.forecastMonth}</td>
                        <td className="p-2 font-numeric">{row.forecastDailyAvg.toFixed(2)}</td>
                        <td className="p-2 font-numeric">{row.actualDailyAvg.toFixed(2)}</td>
                        <td className="p-2 font-numeric">
                          {row.biasVsActual != null
                            ? `${row.biasVsActual >= 0 ? '+' : ''}${(row.biasVsActual * 100).toFixed(1)}%`
                            : '-'}
                        </td>
                        <td className="p-2 font-numeric">
                          {row.mape != null ? `${(row.mape * 100).toFixed(1)}%` : '-'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {(accuracy || walkForwardMutation.data?.accuracyList) && (
                <ListPagination
                  page={accuracyPage}
                  pageSize={listPageSize}
                  total={accuracyListTotal}
                  onPageChange={setAccuracyPage}
                  onPageSizeChange={(next) => {
                    setListPageSize(next);
                    setAccuracyPage(1);
                  }}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      <ForecastSkuDetailDrawer
        versionId={versionId}
        row={selectedHorizonRow}
        horizonPlatform={selectedHorizonPlatform}
        onClose={() => {
          setSelectedHorizonRow(null);
          setSelectedHorizonPlatform('ALL');
        }}
        calibrationEditable={version.status === 'draft'}
      />
    </div>
  );
}
