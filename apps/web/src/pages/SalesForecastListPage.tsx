import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ForecastVersionListItem } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DemandSourceCard } from '@/components/DemandSourceCard';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { ForecastStrategySection } from '@/components/ForecastStrategySection';
import { ForecastVersionStatusBadge } from '@/components/ForecastVersionStatusBadge';
import { ProjectGroupSearchSelect } from '@/components/ProjectGroupSearchSelect';
import {
  buildForecastStartMonthOptions,
  FORECAST_HORIZON_MONTHS,
  formatForecastStartMonth,
} from '@/lib/forecast-horizon-meta';
import {
  formatForecastDateTime,
  isTransientGatewayError,
  mutationErrorMessage,
  sleep,
  buildForecastVersionDetailSearch,
} from '@/lib/forecast-version-utils';
type ListTab = 'versions' | 'strategy';
type StatusFilter = 'all' | 'draft' | 'published' | 'archived';

function splitGenerationSkuCodes(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[\s,，;；]+/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

const LIST_TAB_LABEL: Record<ListTab, string> = {
  versions: '版本列表',
  strategy: '预测策略',
};

export function SalesForecastListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const listTab: ListTab = searchParams.get('tab') === 'strategy' ? 'strategy' : 'versions';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [versionKeyword, setVersionKeyword] = useState('');
  const [appliedVersionKeyword, setAppliedVersionKeyword] = useState('');
  const [versionPage, setVersionPage] = useState(1);
  const [versionPageSize, setVersionPageSize] = useState(20);
  const [generationProjectGroups, setGenerationProjectGroups] = useState<string[]>([]);
  const [generationSkuCode, setGenerationSkuCode] = useState('');
  const [generationStartMonth, setGenerationStartMonth] = useState(() => formatForecastStartMonth());
  const startMonthOptions = useMemo(() => buildForecastStartMonthOptions(), []);
  const [baselineProgress, setBaselineProgress] = useState<string | null>(null);
  const [generationSummary, setGenerationSummary] = useState<string | null>(null);
  const [excludeAccessories, setExcludeAccessories] = useState(true);
  const isBacktestStartMonth = generationStartMonth < formatForecastStartMonth();
  const generationSkuCodes = useMemo(
    () => splitGenerationSkuCodes(generationSkuCode),
    [generationSkuCode],
  );

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['sales-forecast-versions', 'stats', 'list'],
    queryFn: () => api.getSalesForecastVersions({ includeStats: true, statsScope: 'list' }),
    staleTime: 30_000,
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      return rows.some(
        (v) => v.pipelineStatus === 'generating' || v.pipelineStatus === 'landing',
      )
        ? 5000
        : false;
    },
  });

  const publishedVersions = useMemo(
    () =>
      versions
        .filter((v) => v.status === 'published')
        .sort((a, b) => {
          const aTime = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
          const bTime = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
          return bTime - aTime;
        }),
    [versions],
  );
  const latestPublishedVersion = publishedVersions[0];

  const filteredVersions = useMemo(() => {
    if (statusFilter === 'all') return versions;
    return versions.filter((v) => v.status === statusFilter);
  }, [versions, statusFilter]);

  const searchedVersions = useMemo(() => {
    const q = appliedVersionKeyword.trim().toLowerCase();
    if (!q) return filteredVersions;
    return filteredVersions.filter(
      (v) =>
        v.versionName?.toLowerCase().includes(q) ||
        v.versionNo?.toLowerCase().includes(q) ||
        v.station?.toLowerCase().includes(q),
    );
  }, [filteredVersions, appliedVersionKeyword]);

  const pagedVersions = useMemo(() => {
    const start = (versionPage - 1) * versionPageSize;
    return searchedVersions.slice(start, start + versionPageSize);
  }, [searchedVersions, versionPage, versionPageSize]);

  useEffect(() => {
    setVersionPage(1);
  }, [statusFilter, appliedVersionKeyword]);

  useEffect(() => {
    const legacyTab = searchParams.get('tab');
    if (!legacyTab || legacyTab === 'strategy' || legacyTab === 'versions') return;
    if (legacyTab === 'publish') {
      const draft = versions.find((v) => v.status === 'draft');
      if (draft) {
        navigate(`/data/forecast/${draft.id}?view=review`, { replace: true });
        return;
      }
      setSearchParams({}, { replace: true });
      return;
    }
    if (legacyTab === 'insights') {
      const published = versions.find((v) => v.status === 'published');
      if (published) {
        navigate(`/data/forecast/${published.id}?view=accuracy`, { replace: true });
        return;
      }
      setSearchParams({}, { replace: true });
      return;
    }
    if (legacyTab === 'generate') {
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, versions, navigate, setSearchParams]);

  useEffect(() => {
    if (searchParams.get('calibrationImport') !== '1') return;
    const draft = versions.find((v) => v.status === 'draft');
    if (draft) {
      navigate(`/data/forecast/${draft.id}?view=review&calibrationImport=1`, { replace: true });
      return;
    }
    setSearchParams((prev) => {
      prev.delete('calibrationImport');
      return prev;
    }, { replace: true });
  }, [searchParams, versions, navigate, setSearchParams]);

  const generateBaseline = useMutation({
    mutationFn: async () => {
      setBaselineProgress(null);
      const initial = await api.generateSalesForecastBaseline({
        projectGroups: generationProjectGroups.length ? generationProjectGroups : undefined,
        skuCode: generationSkuCode.trim() || undefined,
        monthCount: FORECAST_HORIZON_MONTHS,
        startMonth: generationStartMonth,
        excludeAccessories,
      });

      if (!initial.async) {
        return initial;
      }

      const platformCount = initial.platformCount ?? 5;
      const runningProgress = `后台生成中：约 ${initial.estimatedForecastRows.toLocaleString()} 行（${initial.activeSkuCount.toLocaleString()} SKU × ${initial.monthCount} 月 × ${platformCount} 平台）。请勿再次全量生成。`;
      setBaselineProgress(runningProgress);

      let gatewayBlips = 0;
      for (let attempt = 0; attempt < 600; attempt++) {
        await sleep(attempt < 5 ? 2000 : 5000);
        let task;
        try {
          task = await api.getSalesForecastBaselineTask(initial.taskRunId);
        } catch (err) {
          if (!isTransientGatewayError(err)) throw err;
          gatewayBlips += 1;
          setBaselineProgress(
            `${runningProgress}状态查询被网关打断 ${gatewayBlips} 次，任务仍在后台写入，继续等待…`,
          );
          continue;
        }
        if (task.status === 'running') {
          if (gatewayBlips > 0) {
            gatewayBlips = 0;
            setBaselineProgress(runningProgress);
          }
          continue;
        }
        if (task.status === 'failed') {
          throw new Error(task.errorMessage ?? '后台生成失败');
        }
        if (task.result) {
          setBaselineProgress(null);
          return task.result;
        }
        throw new Error('后台任务已完成但未返回结果');
      }

      throw new Error('等待后台生成超时。任务可能仍在写入，请稍后刷新版本列表，不要再次全量生成');
    },
    onSuccess: async (data) => {
      setBaselineProgress(null);
      const rowInfo = `${data.forecastRows.toLocaleString()} 行预测`;
      const platformInfo = data.platformsGenerated?.length
        ? `（${data.platformsGenerated.length} 个平台）`
        : '';
      setGenerationSummary(`草稿已生成：${rowInfo}${platformInfo}`);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['sales-forecast-horizon'] }),
        qc.invalidateQueries({ queryKey: ['sales-forecast-versions'] }),
        qc.invalidateQueries({ queryKey: ['sales-forecast-version'] }),
        qc.invalidateQueries({ queryKey: ['sales-forecast-version-summary'] }),
        qc.invalidateQueries({ queryKey: ['sales-forecasts'] }),
        qc.invalidateQueries({ queryKey: ['sales-forecast-review-items'] }),
        qc.invalidateQueries({ queryKey: ['sales-forecast-review-stats'] }),
      ]);
      navigate(
        `/data/forecast/${data.version.id}${buildForecastVersionDetailSearch({
          view: 'review',
        })}`,
      );
    },
    onError: () => {
      setBaselineProgress(null);
    },
  });

  const resetAllForecast = useMutation({
    mutationFn: () => api.resetAllSalesForecastData(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-forecast-versions'] });
      qc.invalidateQueries({ queryKey: ['sales-forecasts'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-review-items'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-review-stats'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-trends-horizon'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-horizon'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy'] });
    },
  });

  const deleteDraftVersion = useMutation({
    mutationFn: (id: string) => api.deleteSalesForecastVersion(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-forecast-versions'] });
      qc.invalidateQueries({ queryKey: ['sales-forecasts'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-review-items'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-review-stats'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-horizon'] });
      qc.invalidateQueries({ queryKey: ['sales-forecast-accuracy'] });
    },
  });

  const setListTab = (tab: ListTab) => {
    if (tab === 'strategy') {
      setSearchParams({ tab: 'strategy' });
    } else {
      setSearchParams({});
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader title="销售预测管理">
        <div className="flex flex-wrap items-center gap-2">
          {latestPublishedVersion ? (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-text-sub">
              补货口径：{publishedVersions.length > 1
                ? `${publishedVersions.length} 个已发布版本 · 同 SKU 取最新发布`
                : latestPublishedVersion.versionNo}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
              尚无已发布版本，补货未挂载预测
            </span>
          )}
          {listTab === 'versions' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                document.getElementById('forecast-generate-section')?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              }}
            >
              去生成
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={resetAllForecast.isPending}
            onClick={() => {
              if (
                window.confirm(
                  '将删除全部预测版本、明细、复核项、准确率记录与趋势系数缓存。销量历史不受影响。确定清空？',
                )
              ) {
                resetAllForecast.mutate();
              }
            }}
          >
            {resetAllForecast.isPending ? '清空中…' : '清空预测数据'}
          </Button>
        </div>
      </PageHeader>

      <DemandSourceCard defaultCollapsed />

      <div className="flex flex-wrap gap-2">
        {(['versions', 'strategy'] as ListTab[]).map((tab) => (
          <Button
            key={tab}
            variant={listTab === tab ? 'default' : 'outline'}
            size="sm"
            onClick={() => setListTab(tab)}
          >
            {LIST_TAB_LABEL[tab]}
          </Button>
        ))}
      </div>

      {listTab === 'versions' && (
        <>
          <Card id="forecast-generate-section" className="border-primary/20">
            <CardHeader className="space-y-1 pb-2">
              <CardTitle>生成预测</CardTitle>
              <p className="text-xs text-text-sub">
                基于销量历史生成草稿（固定 6 个月）· ① 生成 → ② 列表复核 → ③ 发布复盘
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <details className="rounded-md border border-border bg-muted/30 p-3 text-xs text-text-sub">
                <summary className="cursor-pointer font-medium text-text-main">操作流程与生成规则（可选阅读）</summary>
                <div className="mt-2 space-y-2 leading-relaxed">
                  <p>
                    每次「生成草稿」均新建独立版本快照（含只填 SKU 的试算），可并列对比不同范围；复核满意后，全量/项目组稿可「发布」，指定
                    SKU 试算稿可「合入当前生效预测」。补货请优先发布「全平台 · 全量 SKU」草稿。同 SKU 多发布稿时取
                    <span className="text-text-main">最新发布时间</span>
                    ；SKU 可一次填多个（逗号或空格分隔）。开始月早于当月的回测草稿仅供准确率复盘，不可发布或合入补货。
                  </p>
                  <p>V4.1 全平台按平台写入。明细默认看合计，需要各平台分行时切换「分平台」。项目组可多选；不选为全部。</p>
                  <ul className="list-disc space-y-1 pl-5">
                    <li>
                      <span className="text-text-main">有预测行</span>：准入通过并写入明细。
                    </li>
                    <li>
                      <span className="text-text-main">仅有复核、无预测行</span>：近端无销量且历史不足，后台留痕。
                    </li>
                    <li>
                      <span className="text-text-main">未触及</span>：无销量记录则跳过。
                    </li>
                    <li>
                      <span className="text-text-main">T99</span>：保守保底；近30=0 归零。
                    </li>
                  </ul>
                </div>
              </details>
              <div className="flex flex-wrap items-end gap-2">
                <label className="w-56 shrink-0 space-y-1 text-sm">
                  <span className="text-text-sub">项目组（可多选，不选为全部）</span>
                  <ProjectGroupSearchSelect
                    value={generationProjectGroups}
                    onChange={(next) => {
                      setGenerationProjectGroups(next);
                      generateBaseline.reset();
                    }}
                    placeholder="搜索项目组…"
                  />
                </label>
                <label className="w-72 shrink-0 space-y-1 text-sm">
                  <span className="text-text-sub">SKU（可选，可多个）</span>
                  <Input
                    placeholder="多个用逗号或空格分隔"
                    className="h-9 w-full"
                    value={generationSkuCode}
                    onChange={(e) => {
                      setGenerationSkuCode(e.target.value);
                      generateBaseline.reset();
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-text-sub">开始月</span>
                  <select
                    className="flex h-9 rounded-md border border-border bg-card px-2 text-sm"
                    value={generationStartMonth}
                    onChange={(e) => {
                      setGenerationStartMonth(e.target.value);
                      generateBaseline.reset();
                    }}
                  >
                    {startMonthOptions.map((month) => (
                      <option key={month} value={month}>
                        {month}
                        {month === formatForecastStartMonth() ? '（当月）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="text-sm text-text-sub">预测周期：固定 6 个月</span>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={excludeAccessories}
                    onChange={(e) => {
                      setExcludeAccessories(e.target.checked);
                      generateBaseline.reset();
                    }}
                  />
                  <span className="text-text-sub">不含配件</span>
                </label>
                <Button
                  disabled={generateBaseline.isPending}
                  onClick={() => {
                    generateBaseline.reset();
                    generateBaseline.mutate();
                  }}
                >
                  {generateBaseline.isPending
                    ? '生成中…'
                    : generationSkuCodes.length > 1
                      ? `生成 ${generationSkuCodes.length} 个 SKU`
                      : generationSkuCodes.length === 1
                        ? '生成单 SKU'
                        : '生成草稿'}
                </Button>
              </div>
              {isBacktestStartMonth && (
                <p className="text-xs text-text-sub">训练数据截止至开始月之前（严格回测）</p>
              )}
              {baselineProgress && <p className="text-sm text-text-sub">{baselineProgress}</p>}
              {generationSummary && !generateBaseline.isPending && (
                <p className="text-sm text-primary">{generationSummary}</p>
              )}
              {generateBaseline.isError && (
                <p className="text-sm text-destructive">{mutationErrorMessage(generateBaseline.error)}</p>
              )}
              {resetAllForecast.isSuccess && (
                <p className="text-xs text-text-sub">
                  已清空：版本 {resetAllForecast.data.deleted.versions} · 预测行{' '}
                  {resetAllForecast.data.deleted.forecastMonthly} · 复核{' '}
                  {resetAllForecast.data.deleted.reviewItems}
                </p>
              )}
              {resetAllForecast.isError && (
                <p className="text-xs text-destructive">{mutationErrorMessage(resetAllForecast.error)}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle>预测版本</CardTitle>
              <div className="flex flex-wrap gap-2">
                {(['all', 'draft', 'published', 'archived'] as StatusFilter[]).map((filter) => (
                  <Button
                    key={filter}
                    size="sm"
                    variant={statusFilter === filter ? 'default' : 'outline'}
                    onClick={() => setStatusFilter(filter)}
                  >
                    {filter === 'all'
                      ? '全部'
                      : filter === 'draft'
                        ? '草稿'
                        : filter === 'published'
                          ? '已发布'
                          : '已归档'}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent>
              <ListSearchBar
                keyword={versionKeyword}
                onKeywordChange={setVersionKeyword}
                onSearch={() => {
                  setAppliedVersionKeyword(versionKeyword.trim());
                  setVersionPage(1);
                }}
                placeholder="版本号 / 名称 / 站点"
              />
              {deleteDraftVersion.isError && (
                <p className="mb-3 text-sm text-destructive">
                  {mutationErrorMessage(deleteDraftVersion.error)}
                </p>
              )}
              {isLoading ? (
                <p className="text-sm text-text-sub">加载中…</p>
              ) : searchedVersions.length === 0 ? (
                <p className="text-sm text-text-sub">暂无预测版本，请先生成草稿。</p>
              ) : (
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-text-sub">
                        <th className="p-2 font-normal">版本</th>
                        <th className="p-2 font-normal">状态</th>
                        <th className="p-2 font-normal">开始月 / 月数</th>
                        <th className="p-2 font-normal">SKU / 行数</th>
                        <th className="p-2 font-normal">创建 / 发布</th>
                        <th className="p-2 font-normal">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedVersions.map((version) => (
                        <VersionRow
                          key={version.id}
                          version={version}
                          deleting={deleteDraftVersion.isPending && deleteDraftVersion.variables === version.id}
                          onDelete={(id) => {
                            const target = versions.find((v) => v.id === id);
                            const label = target?.versionName || target?.versionNo || id;
                            if (
                              window.confirm(
                                `确定删除草稿「${label}」？将同步删除其预测明细与复核项，且不可恢复。`,
                              )
                            ) {
                              deleteDraftVersion.mutate(id);
                            }
                          }}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {!isLoading && searchedVersions.length > 0 && (
                <ListPagination
                  page={versionPage}
                  pageSize={versionPageSize}
                  total={searchedVersions.length}
                  onPageChange={setVersionPage}
                  onPageSizeChange={(next) => {
                    setVersionPageSize(next);
                    setVersionPage(1);
                  }}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {listTab === 'strategy' && <ForecastStrategySection active />}
    </div>
  );
}

function VersionRow({
  version,
  deleting,
  onDelete,
}: {
  version: ForecastVersionListItem;
  deleting?: boolean;
  onDelete?: (id: string) => void;
}) {
  const scopeLabel =
    version.versionName && version.versionName !== version.versionNo
      ? version.versionName
      : null;
  const detailSearch = buildForecastVersionDetailSearch({
    platform: version.generationPlatform,
  });
  const reviewSearch = buildForecastVersionDetailSearch({
    view: 'review',
    platform: version.generationPlatform,
  });
  const accuracySearch = buildForecastVersionDetailSearch({ view: 'accuracy' });
  return (
    <tr className="border-b border-border/60 align-top">
      <td className="p-2">
        {scopeLabel ? (
          <>
            <p className="font-medium text-sm text-text-main">{scopeLabel}</p>
            <p className="font-mono text-xs text-text-sub">{version.versionNo}</p>
          </>
        ) : (
          <p className="font-medium font-mono text-sm">{version.versionNo}</p>
        )}
      </td>
      <td className="p-2">
        <ForecastVersionStatusBadge status={version.status} />
      </td>
      <td className="p-2 font-numeric">
        <span>{version.startMonth ?? '—'}</span>
        <span className="text-text-sub">
          {' · '}
          {version.stats.monthCount || '-'} 月
          {version.stats.monthCount && version.stats.monthCount !== 6 ? '（历史周期）' : ''}
        </span>
      </td>
      <td className="p-2 font-numeric">
        {version.stats.skuCount.toLocaleString()} / {version.stats.forecastRowCount.toLocaleString()}
      </td>
      <td className="p-2 text-xs text-text-sub">
        <p>创建 {formatForecastDateTime(version.createdAt)}</p>
        {version.publishedAt && <p>发布 {formatForecastDateTime(version.publishedAt)}</p>}
      </td>
      <td className="p-2">
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/data/forecast/${version.id}${detailSearch}`}
            className="text-primary hover:underline"
          >
            查看
          </Link>
          {version.status === 'draft' && (
            <Link
              to={`/data/forecast/${version.id}${reviewSearch}`}
              className="text-primary hover:underline"
            >
              去复核
            </Link>
          )}
          {version.status === 'draft' && onDelete && (
            <button
              type="button"
              className="text-destructive hover:underline disabled:opacity-50"
              disabled={deleting}
              onClick={() => onDelete(version.id)}
            >
              {deleting ? '删除中…' : '删除'}
            </button>
          )}
          {(version.status === 'draft' ||
            version.status === 'published' ||
            version.status === 'archived') && (
            <Link
              to={`/data/forecast/${version.id}${accuracySearch}`}
              className="text-primary hover:underline"
            >
              复盘
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}
