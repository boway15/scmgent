import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type ForecastVersionListItem } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/PageHeader';
import { ForecastStrategySection } from '@/components/ForecastStrategySection';
import { ForecastVersionStatusBadge } from '@/components/ForecastVersionStatusBadge';
import { CategorySearchSelect } from '@/components/CategorySearchSelect';
import { FORECAST_GENERATION_MONTH_OPTIONS, FORECAST_GENERATION_PLATFORM_CODES } from '@/lib/forecast-horizon-meta';
import {
  formatForecastDateTime,
  formatForecastWmape,
  mutationErrorMessage,
  sleep,
  buildForecastVersionDetailSearch,
} from '@/lib/forecast-version-utils';

type ListTab = 'versions' | 'strategy';
type StatusFilter = 'all' | 'draft' | 'published' | 'archived';

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
  const [generationPlatform, setGenerationPlatform] = useState('ALL');
  const [generationCategory, setGenerationCategory] = useState('');
  const [generationSkuCode, setGenerationSkuCode] = useState('');
  const [generationMonthCount, setGenerationMonthCount] = useState(6);
  const [baselineProgress, setBaselineProgress] = useState<string | null>(null);
  const [generationSummary, setGenerationSummary] = useState<string | null>(null);

  const { data: versions = [], isLoading } = useQuery({
    queryKey: ['sales-forecast-versions', 'stats'],
    queryFn: () => api.getSalesForecastVersions({ includeStats: true }),
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

  const { data: generationPlatforms } = useQuery({
    queryKey: ['sales-platforms', 'all'],
    queryFn: () => api.getSalesPlatforms(),
  });

  const generationPlatformOptions = useMemo(
    () =>
      (generationPlatforms ?? [{ code: 'ALL', name: '全平台' }]).filter((item) =>
        FORECAST_GENERATION_PLATFORM_CODES.has(item.code),
      ),
    [generationPlatforms],
  );

  useEffect(() => {
    if (!generationPlatformOptions.length) return;
    if (!generationPlatformOptions.some((item) => item.code === generationPlatform)) {
      setGenerationPlatform('ALL');
    }
  }, [generationPlatformOptions, generationPlatform]);

  const generateBaseline = useMutation({
    mutationFn: async () => {
      setBaselineProgress(null);
      const initial = await api.generateSalesForecastBaseline({
        platform: generationPlatform.trim() || undefined,
        category: generationCategory.trim() || undefined,
        skuCode: generationSkuCode.trim() || undefined,
        monthCount: generationMonthCount,
      });

      if (!initial.async) {
        return initial;
      }

      const platformCount = initial.platformCount ?? 5;
      setBaselineProgress(
        `后台生成中：约 ${initial.estimatedForecastRows.toLocaleString()} 行（${initial.activeSkuCount.toLocaleString()} SKU × ${initial.monthCount} 月 × ${platformCount} 平台），请稍候…`,
      );

      for (let attempt = 0; attempt < 600; attempt++) {
        await sleep(attempt < 5 ? 2000 : 5000);
        const task = await api.getSalesForecastBaselineTask(initial.taskRunId);
        if (task.status === 'running') continue;
        if (task.status === 'failed') {
          throw new Error(task.errorMessage ?? '后台生成失败');
        }
        if (task.result) {
          setBaselineProgress(null);
          return task.result;
        }
        throw new Error('后台任务已完成但未返回结果');
      }

      throw new Error('后台生成超时，请稍后在版本列表查看是否已生成草稿');
    },
    onSuccess: async (data) => {
      setBaselineProgress(null);
      const platformLabel =
        generationPlatformOptions.find((item) => item.code === generationPlatform)?.name ??
        generationPlatform;
      const rowInfo = `${data.forecastRows.toLocaleString()} 行预测`;
      const platformInfo =
        data.platformsGenerated?.length === 1
          ? `（${platformLabel}）`
          : data.platformsGenerated?.length
            ? `（${data.platformsGenerated.length} 个渠道）`
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
      const platformParam =
        generationPlatform.trim() && generationPlatform !== 'ALL'
          ? generationPlatform
          : null;
      navigate(
        `/data/forecast/${data.version.id}${buildForecastVersionDetailSearch({
          view: 'review',
          platform: platformParam,
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

  const setListTab = (tab: ListTab) => {
    if (tab === 'strategy') {
      setSearchParams({ tab: 'strategy' });
    } else {
      setSearchParams({});
    }
  };

  return (
    <div className="space-y-6">
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
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="space-y-3 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-medium text-text-main">操作流程</span>
                <span className="text-text-sub">① 生成预测</span>
                <span className="text-text-sub">→</span>
                <span className="text-text-sub">② 版本列表选草稿复核</span>
                <span className="text-text-sub">→</span>
                <span className="text-text-sub">③ 发布后复盘准确率</span>
              </div>
              <p className="text-xs text-text-sub">
                每次「生成草稿」都会新建一条版本快照（名称含月数、渠道、范围），可在列表中并列对比——例如
                3 个月 vs 6 个月、全平台 vs 单渠道实验稿。复核满意后发布其中一条；旧草稿可保留或忽略。
              </p>
              <p className="text-xs text-text-sub">
                <span className="text-text-main">单 SKU 生成</span>默认写入最新草稿（局部刷新该 SKU）；
                若需指定草稿，可在 API 传 <code className="font-mono">targetVersionId</code>。
                补货挂载请优先发布「全平台 · 全量 SKU」且月数满足计划的草稿。
              </p>
              <p className="text-xs text-text-sub">
                可发布多个版本；若不同发布稿包含同一商品，补货与库存健康按该 SKU
                <span className="text-text-main"> 最新发布时间 </span>
                的预测为准（旧发布稿可手动归档）。
              </p>
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
            <CardHeader>
              <CardTitle>生成预测</CardTitle>
              <p className="text-sm text-text-sub">
                基于「销量历史」已入库的日/月销数据生成预测草稿。选择「全平台」时按 V4.1 支持渠道分别写入，列表查询
                ALL 为分渠道汇总。
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-text-sub">
                <li>
                  <span className="text-text-main">有预测行</span>：该渠道通过准入并写入预测明细（列表「SKU / 行数」中的
                  SKU 数为有预测行的去重商品数）。
                </li>
                <li>
                  <span className="text-text-main">仅有复核、无预测行</span>：例如该渠道近 90 天无销量且历史不足，系统跳过预测、仅在后台留痕，界面不再单独展示复核清单。
                </li>
                <li>
                  <span className="text-text-main">未触及</span>：各渠道均无销量记录，生成时直接跳过，不写预测也不留复核。
                </li>
                <li>
                  <span className="text-text-main">T99</span>：近 30 天日均 ≤ 0.2 且波动/连续性不足时系统写 0.00；近 30 天日均 &gt; 0.2 时优先保底预测（T4B），不轻易归入 T99。
                </li>
              </ul>
              <p className="mt-2 text-xs text-text-sub">
                单渠道 / 品类 / 单 SKU 生成会各自产生独立快照（或单 SKU 合并进目标草稿），便于实验对比；正式补货建议用「全平台」全量生成。
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end gap-2">
                <label className="space-y-1 text-sm">
                  <span className="text-text-sub">渠道</span>
                  <select
                    className="flex h-9 min-w-28 rounded-md border border-border bg-card px-2 text-sm"
                    value={generationPlatform}
                    onChange={(e) => {
                      setGenerationPlatform(e.target.value);
                      generateBaseline.reset();
                    }}
                  >
                    {(generationPlatformOptions).map((item) => (
                      <option key={item.code} value={item.code}>
                        {item.name || item.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-text-sub">品类</span>
                  <CategorySearchSelect
                    scope="forecast"
                    value={generationCategory}
                    onChange={(next) => {
                      setGenerationCategory(next);
                      generateBaseline.reset();
                    }}
                    placeholder="搜索品类…"
                    className="w-full max-w-md"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-text-sub">单 SKU（可选）</span>
                  <Input
                    placeholder="如 ABC-123"
                    className="h-9 w-36"
                    value={generationSkuCode}
                    onChange={(e) => {
                      setGenerationSkuCode(e.target.value);
                      generateBaseline.reset();
                    }}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-text-sub">预测月数</span>
                  <select
                    className="flex h-9 rounded-md border border-border bg-card px-2 text-sm"
                    value={generationMonthCount}
                    onChange={(e) => {
                      setGenerationMonthCount(Number(e.target.value));
                      generateBaseline.reset();
                    }}
                  >
                    {[...FORECAST_GENERATION_MONTH_OPTIONS].map((count) => (
                      <option key={count} value={count}>
                        {count} 个月
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  disabled={generateBaseline.isPending}
                  onClick={() => {
                    generateBaseline.reset();
                    generateBaseline.mutate();
                  }}
                >
                  {generateBaseline.isPending ? '生成中…' : generationSkuCode.trim() ? '生成单 SKU' : '生成草稿'}
                </Button>
              </div>
              {baselineProgress && <p className="text-sm text-text-sub">{baselineProgress}</p>}
              {generationSummary && !generateBaseline.isPending && (
                <p className="text-sm text-primary">{generationSummary}</p>
              )}
              {generateBaseline.isError && (
                <p className="text-sm text-destructive">{mutationErrorMessage(generateBaseline.error)}</p>
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
              {isLoading ? (
                <p className="text-sm text-text-sub">加载中…</p>
              ) : filteredVersions.length === 0 ? (
                <p className="text-sm text-text-sub">暂无预测版本，请先生成草稿。</p>
              ) : (
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-text-sub">
                        <th className="p-2 font-normal">版本</th>
                        <th className="p-2 font-normal">状态</th>
                        <th className="p-2 font-normal">范围</th>
                        <th className="p-2 font-normal">SKU / 行数</th>
                        <th className="p-2 font-normal">准确率</th>
                        <th className="p-2 font-normal">创建 / 发布</th>
                        <th className="p-2 font-normal">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredVersions.map((version) => (
                        <VersionRow key={version.id} version={version} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {listTab === 'strategy' && <ForecastStrategySection active />}
    </div>
  );
}

function VersionRow({ version }: { version: ForecastVersionListItem }) {
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
      <td className="p-2 font-numeric">{version.stats.monthCount || '-'} 月</td>
      <td className="p-2 font-numeric">
        {version.stats.skuCount.toLocaleString()} / {version.stats.forecastRowCount.toLocaleString()}
      </td>
      <td className="p-2 font-numeric">
        {version.status === 'published' || version.status === 'archived'
          ? formatForecastWmape(version.stats.accuracyWmape)
          : '-'}
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
          {(version.status === 'published' || version.status === 'archived') && (
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
