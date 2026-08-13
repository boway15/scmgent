import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ForecastDataExplorer } from '@/components/ForecastDataExplorer';
import { ForecastSkuDetailDrawer, type ForecastHorizonRow } from '@/components/ForecastSkuDetailDrawer';
import { ForecastAccuracyDiagnosticsPanel } from '@/components/ForecastAccuracyDiagnosticsPanel';
import { ForecastVersionStatusBadge } from '@/components/ForecastVersionStatusBadge';
import { resolveHorizonPlatformScope } from '@/lib/forecast-horizon-meta';
import { formatForecastVersionTitle, mutationErrorMessage, buildForecastVersionDetailSearch, resolveForecastExplorerPlatform } from '@/lib/forecast-version-utils';
import { formatTierDisplayLabel } from '@/lib/forecast-labels';

type DetailView = 'data' | 'review' | 'accuracy';
type AccuracyListTab = 'detail' | 'miss';

const VIEW_LABEL: Record<DetailView, string> = {
  data: '数据明细',
  review: '复核与发布',
  accuracy: '准确率复盘',
};

const LIST_PAGE_SIZE = 20;

function isViewAllowed(view: DetailView, status: string): boolean {
  if (view === 'data') return true;
  if (view === 'review') return status === 'draft';
  if (view === 'accuracy') return status === 'draft' || status === 'published' || status === 'archived';
  return false;
}

export function SalesForecastVersionDetailPage() {
  const { versionId = '' } = useParams<{ versionId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedHorizonRow, setSelectedHorizonRow] = useState<ForecastHorizonRow | null>(null);
  const [selectedHorizonPlatform, setSelectedHorizonPlatform] = useState('ALL');
  const [accuracyPage, setAccuracyPage] = useState(1);
  const [accuracyMissPage, setAccuracyMissPage] = useState(1);
  const [accuracyListTab, setAccuracyListTab] = useState<AccuracyListTab>('detail');
  const [accuracyExporting, setAccuracyExporting] = useState(false);
  const [listPageSize, setListPageSize] = useState(LIST_PAGE_SIZE);

  const { data: version, isLoading, isError } = useQuery({
    queryKey: ['sales-forecast-version', versionId],
    queryFn: () => api.getSalesForecastVersion(versionId),
    enabled: Boolean(versionId),
  });

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
    setAccuracyMissPage(1);
    setAccuracyListTab('detail');
  }, [versionId]);

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
    queryKey: ['sales-forecast-accuracy', versionId, accuracyPage, listPageSize, 'predicted'],
    queryFn: () =>
      api.getSalesForecastAccuracy({
        versionId,
        page: accuracyPage,
        pageSize: listPageSize,
        rowKind: 'predicted',
      }),
    enabled: activeView === 'accuracy' && accuracyListTab === 'detail' && Boolean(versionId),
  });

  const { data: accuracyMiss } = useQuery({
    queryKey: ['sales-forecast-accuracy', versionId, accuracyMissPage, listPageSize, 'miss'],
    queryFn: () =>
      api.getSalesForecastAccuracy({
        versionId,
        page: accuracyMissPage,
        pageSize: listPageSize,
        rowKind: 'miss',
      }),
    enabled: activeView === 'accuracy' && accuracyListTab === 'miss' && Boolean(versionId),
  });

  const {
    data: accuracyDiagnostics,
    isLoading: accuracyDiagnosticsLoading,
    error: accuracyDiagnosticsError,
  } = useQuery({
    queryKey: ['sales-forecast-accuracy-diagnostics', versionId],
    queryFn: () =>
      api.getSalesForecastAccuracyDiagnostics({ versionId, limitTopErrors: 10 }),
    enabled: activeView === 'accuracy' && Boolean(versionId),
  });

  const { data: qtyTotals } = useQuery({
    queryKey: ['sales-forecast-version-qty-totals', versionId],
    queryFn: () => api.getSalesForecastVersionQtyTotals(versionId),
    enabled: activeView === 'accuracy' && Boolean(versionId),
  });

  const publishVersion = useMutation({
    mutationFn: () => api.publishSalesForecastVersion(versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-forecast-versions'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-version', versionId] });
      qc.invalidateQueries({ queryKey: ['sales-forecasts'] });
      setSearchParams({ view: 'data' });
    },
  });

  const deleteDraftVersion = useMutation({
    mutationFn: () => api.deleteSalesForecastVersion(versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-forecast-versions'] });
      qc.invalidateQueries({ queryKey: ['sales-forecasts'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-review-items'] });
      navigate('/data/forecast');
    },
  });

  const accuracyBacktestMutation = useMutation({
    mutationFn: () =>
      api.backtestSalesForecastAccuracy({
        versionId,
        createReviewItems: true,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy-diagnostics'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-review-items'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-version', versionId] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-version-qty-totals', versionId] });
    },
  });

  const accuracyListItems =
    accuracyListTab === 'miss' ? (accuracyMiss?.items ?? []) : (accuracy?.items ?? []);
  const accuracyListTotal =
    accuracyListTab === 'miss' ? (accuracyMiss?.total ?? 0) : (accuracy?.total ?? 0);
  const accuracyListPage = accuracyListTab === 'miss' ? accuracyMissPage : accuracyPage;
  const setAccuracyListPage =
    accuracyListTab === 'miss' ? setAccuracyMissPage : setAccuracyPage;

  const handleSkuClick = (row: ForecastHorizonRow, ctx?: { platform: string }) => {
    setSelectedHorizonRow(row);
    setSelectedHorizonPlatform(ctx?.platform ?? row.platform ?? 'ALL');
  };

  const availableViews = useMemo(() => {
    if (!version) return ['data'] as DetailView[];
    const views: DetailView[] = ['data'];
    if (version.status === 'draft') views.push('review');
    if (version.status === 'draft' || version.status === 'published' || version.status === 'archived') {
      views.push('accuracy');
    }
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
          <span className="text-xs text-text-sub">开始月：{version.startMonth ?? '—'}</span>
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
                className="text-destructive"
                disabled={deleteDraftVersion.isPending}
                onClick={() => {
                  const label = version.versionName || version.versionNo;
                  if (
                    window.confirm(
                      `确定删除草稿「${label}」？将同步删除其预测明细与复核项，且不可恢复。`,
                    )
                  ) {
                    deleteDraftVersion.mutate();
                  }
                }}
              >
                {deleteDraftVersion.isPending ? '删除中…' : '删除草稿'}
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
            {deleteDraftVersion.isError && (
              <p className="text-sm text-destructive">{mutationErrorMessage(deleteDraftVersion.error)}</p>
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
              ? '常规商品与 T99 在同一矩阵展示；T99 为系统保守保底（断销时为 0）；可用分层筛选或「待校准（T99）」快捷按钮定位未校准 SKU，点击 SKU 在抽屉中 AI 辅助或人工校准。'
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
              <p className="text-sm text-text-main">
                预测值 / 实际值：
                <span className="font-numeric font-medium">{qtyTotals?.label ?? '—'}</span>
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['detail', '复盘明细'],
                    ['miss', '漏报'],
                  ] as const
                ).map(([tab, label]) => (
                  <Button
                    key={tab}
                    size="sm"
                    variant={accuracyListTab === tab ? 'default' : 'outline'}
                    onClick={() => setAccuracyListTab(tab)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  disabled={accuracyBacktestMutation.isPending}
                  onClick={() => accuracyBacktestMutation.mutate()}
                >
                  {accuracyBacktestMutation.isPending ? '回测中…' : '按开始月复盘回测'}
                </Button>
                {accuracyListTab === 'detail' ? (
                  <>
                    <Button
                      variant="outline"
                      disabled={accuracyExporting || !versionId || accuracyListTotal === 0}
                      onClick={async () => {
                        setAccuracyExporting(true);
                        try {
                          await api.exportSalesForecastAccuracy({
                            versionId,
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
                      disabled={accuracyExporting || !versionId || accuracyListTotal === 0}
                      onClick={async () => {
                        setAccuracyExporting(true);
                        try {
                          await api.exportSalesForecastAccuracy({
                            versionId,
                            rowKind: 'predicted',
                          });
                        } finally {
                          setAccuracyExporting(false);
                        }
                      }}
                    >
                      {accuracyExporting ? '导出中…' : '导出 CSV'}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      disabled={accuracyExporting || !versionId || accuracyListTotal === 0}
                      onClick={async () => {
                        setAccuracyExporting(true);
                        try {
                          await api.exportSalesForecastAccuracy({
                            versionId,
                            groupBy: 'sku',
                            rowKind: 'miss',
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
                      disabled={accuracyExporting || !versionId || accuracyListTotal === 0}
                      onClick={async () => {
                        setAccuracyExporting(true);
                        try {
                          await api.exportSalesForecastAccuracy({
                            versionId,
                            rowKind: 'miss',
                          });
                        } finally {
                          setAccuracyExporting(false);
                        }
                      }}
                    >
                      {accuracyExporting ? '导出中…' : '导出漏报 CSV'}
                    </Button>
                  </>
                )}
              </div>
              {accuracyBacktestMutation.isError && (
                <p className="text-sm text-destructive">{mutationErrorMessage(accuracyBacktestMutation.error)}</p>
              )}
              {accuracyListTab === 'miss' && (
                <p className="text-sm text-text-sub">
                  漏报：预测日均=0 且实际日均&gt;0。不计入上方「预测值 / 实际值」与主 KPI。
                </p>
              )}
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">商品编码</th>
                    <th className="p-2 font-normal">项目组</th>
                    <th className="p-2 font-normal">商品分层</th>
                    <th className="p-2 font-normal">渠道</th>
                    <th className="p-2 font-normal">月份</th>
                    <th className="p-2 font-normal">预测日均</th>
                    <th className="p-2 font-normal">实际日均</th>
                    {accuracyListTab === 'detail' ? (
                      <th className="p-2 font-normal">偏差</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {accuracyListItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={accuracyListTab === 'detail' ? 8 : 7}
                        className="p-4 text-center text-text-sub"
                      >
                        {accuracyListTab === 'miss'
                          ? '暂无漏报记录；可对当前版本运行「按开始月复盘回测」。'
                          : '暂无准确率记录；可对当前版本运行「按开始月复盘回测」。（需历史开始月且已结束月份有实际销量。）'}
                      </td>
                    </tr>
                  ) : (
                    accuracyListItems.map((row) => (
                      <tr key={row.id} className="border-b border-border/60">
                        <td className="p-2">{row.skuCode}</td>
                        <td className="p-2 text-text-sub">{row.projectGroup?.trim() || '-'}</td>
                        <td className="p-2 text-text-sub">
                          {formatTierDisplayLabel(row.profileSegment, null)}
                        </td>
                        <td className="p-2">{row.platform}</td>
                        <td className="p-2">{row.forecastMonth}</td>
                        <td className="p-2 font-numeric">{row.forecastDailyAvg.toFixed(2)}</td>
                        <td className="p-2 font-numeric">{row.actualDailyAvg.toFixed(2)}</td>
                        {accuracyListTab === 'detail' ? (
                          <td className="p-2 font-numeric">
                            {row.biasVsActual != null
                              ? `${row.biasVsActual >= 0 ? '+' : ''}${(row.biasVsActual * 100).toFixed(1)}%`
                              : '-'}
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              {(accuracyListTab === 'detail' ? accuracy : accuracyMiss) && (
                <ListPagination
                  page={accuracyListPage}
                  pageSize={listPageSize}
                  total={accuracyListTotal}
                  onPageChange={setAccuracyListPage}
                  onPageSizeChange={(next) => {
                    setListPageSize(next);
                    setAccuracyPage(1);
                    setAccuracyMissPage(1);
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
        forecastMonthCount={version.stats.monthCount > 0 ? version.stats.monthCount : undefined}
      />
    </div>
  );
}
