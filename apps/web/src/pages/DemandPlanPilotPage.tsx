import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DemandPlanVersionListItem } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import {
  DEMAND_PLAN_GENERATE_HINT,
  DEMAND_PLAN_SCOPE_NOTICE,
} from '@/lib/product-scope-copy';
import { ListPagination } from '@/components/ListPagination';
import { ListSearchBar } from '@/components/ListSearchBar';
import { DemandPlanVersionStatusBadge } from '@/components/DemandPlanVersionStatusBadge';
import { ForecastStrategySection } from '@/components/ForecastStrategySection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  formatForecastDateTime,
  mutationErrorMessage,
} from '@/lib/forecast-version-utils';
import {
  buildDemandPlanVersionDetailSearch,
  DEMAND_PLAN_HORIZON_WEEKS,
  DEMAND_PLAN_REPLENISHMENT_DEFER_NOTICE,
  DEMAND_PLAN_STATUS_LABEL,
  formatDemandPlanHorizon,
  formatDemandPlanProjectGroup,
} from '@/lib/demand-plan-utils';
import {
  buildDemandPlanStartWeekOptions,
  formatIsoWeekMondayMd,
  isDemandPlanStartWeekBacktest,
} from '@/lib/iso-week';

type ListTab = 'versions' | 'strategy';
type StatusFilter = 'all' | 'draft' | 'pilot_published' | 'archived';

const LIST_TAB_LABEL: Record<ListTab, string> = {
  versions: '版本列表',
  strategy: '预测策略',
};

const STATUS_FILTER_LABEL: Record<StatusFilter, string> = {
  all: '全部',
  draft: DEMAND_PLAN_STATUS_LABEL.draft,
  pilot_published: DEMAND_PLAN_STATUS_LABEL.pilot_published,
  archived: DEMAND_PLAN_STATUS_LABEL.archived,
};

export function DemandPlanPilotPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const listTab: ListTab = searchParams.get('tab') === 'strategy' ? 'strategy' : 'versions';
  const [versionName, setVersionName] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [keyword, setKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [generationSummary, setGenerationSummary] = useState<string | null>(null);
  const startWeekOptions = useMemo(() => buildDemandPlanStartWeekOptions(), []);
  const [generationStartWeek, setGenerationStartWeek] = useState(() => startWeekOptions[0] ?? '');
  const generationIsBacktest = useMemo(
    () => Boolean(generationStartWeek) && isDemandPlanStartWeekBacktest(generationStartWeek),
    [generationStartWeek],
  );

  const versionsQuery = useQuery({
    queryKey: ['demand-plan-versions', 'all'],
    queryFn: () => api.listDemandPlanVersions({ pageSize: 500 }),
  });

  const versions = versionsQuery.data?.items ?? [];
  const adoptedPublished = useMemo(
    () => versions.filter((row) => row.status === 'pilot_published'),
    [versions],
  );

  const filteredVersions = useMemo(() => {
    if (statusFilter === 'all') return versions;
    return versions.filter((row) => row.status === statusFilter);
  }, [versions, statusFilter]);

  const searchedVersions = useMemo(() => {
    const q = appliedKeyword.trim().toLowerCase();
    if (!q) return filteredVersions;
    return filteredVersions.filter(
      (row) =>
        row.versionName?.toLowerCase().includes(q) ||
        row.versionNo?.toLowerCase().includes(q) ||
        formatDemandPlanProjectGroup(row.projectGroup).toLowerCase().includes(q),
    );
  }, [filteredVersions, appliedKeyword]);

  const pagedVersions = useMemo(() => {
    const start = (page - 1) * pageSize;
    return searchedVersions.slice(start, start + pageSize);
  }, [searchedVersions, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, appliedKeyword]);

  const setListTab = (tab: ListTab) => {
    if (tab === 'strategy') {
      setSearchParams({ tab: 'strategy' });
    } else {
      setSearchParams({});
    }
  };

  const generate = useMutation({
    mutationFn: () =>
      api.generateDemandPlan({
        versionName: versionName.trim() || undefined,
        startWeek: generationStartWeek || undefined,
      }),
    onSuccess: async (result) => {
      const skipped = result.skipped.length;
      setGenerationSummary(
        skipped > 0
          ? `草稿已生成，已跳过 ${skipped} 个 SKU`
          : '草稿已生成',
      );
      await queryClient.invalidateQueries({ queryKey: ['demand-plan-versions'] });
      navigate(
        `/data/demand-plan/${result.version.id}${buildDemandPlanVersionDetailSearch({ view: 'review' })}`,
      );
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="周度销量预测">
        <div className="flex flex-wrap items-center gap-2">
          {listTab === 'versions' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                document.getElementById('demand-plan-generate-section')?.scrollIntoView({
                  behavior: 'smooth',
                  block: 'start',
                });
              }}
            >
              去生成
            </Button>
          ) : null}
          {adoptedPublished.length > 0 ? (
            <span className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-text-sub">
              已发布 {adoptedPublished.length} 个版本 · 「已发布」≠ 已接入补货
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-800 dark:text-amber-200">
              尚无已发布周预测
            </span>
          )}
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
            <span className="text-text-sub">① 生成草稿</span>
            <span className="text-text-sub">→</span>
            <span className="text-text-sub">② 版本列表选草稿复核校准</span>
            <span className="text-text-sub">→</span>
            <span className="text-text-sub">③ 发布（冻结周预测版本）</span>
          </div>
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
            {DEMAND_PLAN_REPLENISHMENT_DEFER_NOTICE}
          </p>
          <p className="text-xs text-text-sub">
            固定 {DEMAND_PLAN_HORIZON_WEEKS} 个 ISO 周（约 180 天），对全量启用 SKU 生成。月曲线为内联 V4.1（不依赖月版本发布）；矩阵系统日均在前 4 周向近 14/30/90 天混合，第 5 周起等于拆周。T 分层写入周行。
            与销量预测模块独立。
          </p>
          <p className="text-sm text-text-main">{DEMAND_PLAN_SCOPE_NOTICE}</p>
        </CardContent>
      </Card>

      <Card id="demand-plan-generate-section">
        <CardHeader>
          <CardTitle>生成草稿</CardTitle>
          <p className="text-sm text-text-sub">{DEMAND_PLAN_GENERATE_HINT}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">版本名称（可选）</span>
              <Input
                className="h-9 w-48"
                value={versionName}
                placeholder="默认用版本号"
                onChange={(event) => setVersionName(event.target.value)}
              />
            </label>
            <div className="space-y-1 text-sm">
              <span className="text-text-sub">计划范围</span>
              <p className="flex h-9 items-center text-text-main">全量 SKU · 固定 {DEMAND_PLAN_HORIZON_WEEKS} 周</p>
            </div>
            <label className="space-y-1 text-sm">
              <span className="text-text-sub">开始周（周一）</span>
              <select
                className="flex h-9 min-w-[10rem] rounded-md border border-input bg-background px-2 font-mono text-sm"
                value={generationStartWeek}
                onChange={(event) => setGenerationStartWeek(event.target.value)}
              >
                {startWeekOptions.map((week) => (
                  <option key={week} value={week}>
                    周一 {formatIsoWeekMondayMd(week)}（{week}）
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={generate.isPending} onClick={() => generate.mutate()}>
              {generate.isPending ? '生成中…' : '生成草稿'}
            </Button>
          </div>
          {generationIsBacktest ? (
            <p className="text-xs text-text-sub">
              训练数据截止至开始周之前（严格回测）；仅供复盘对照，不建议发布并采用。
            </p>
          ) : null}
          {generationSummary && !generate.isPending && (
            <p className="text-sm text-primary">{generationSummary}</p>
          )}
          {generate.isError && (
            <p className="text-sm text-destructive">{mutationErrorMessage(generate.error)}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>计划版本</CardTitle>
          <div className="flex flex-wrap gap-2">
            {(['all', 'draft', 'pilot_published', 'archived'] as StatusFilter[]).map((filter) => (
              <Button
                key={filter}
                size="sm"
                variant={statusFilter === filter ? 'default' : 'outline'}
                onClick={() => setStatusFilter(filter)}
              >
                {STATUS_FILTER_LABEL[filter]}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <ListSearchBar
            keyword={keyword}
            onKeywordChange={setKeyword}
            onSearch={() => {
              setAppliedKeyword(keyword.trim());
              setPage(1);
            }}
            placeholder="版本号 / 名称"
          />
          {versionsQuery.isLoading ? (
            <p className="text-sm text-text-sub">加载中…</p>
          ) : searchedVersions.length === 0 ? (
            <p className="text-sm text-text-sub">暂无需求计划版本，请先生成草稿。</p>
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">版本</th>
                    <th className="p-2 font-normal">状态</th>
                    <th className="p-2 font-normal">范围 / 周期</th>
                    <th className="p-2 font-normal">创建 / 发布</th>
                    <th className="p-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedVersions.map((version) => (
                    <VersionRow key={version.id} version={version} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!versionsQuery.isLoading && searchedVersions.length > 0 && (
            <ListPagination
              page={page}
              pageSize={pageSize}
              total={searchedVersions.length}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next);
                setPage(1);
              }}
            />
          )}
        </CardContent>
      </Card>
        </>
      )}

      {listTab === 'strategy' && <ForecastStrategySection active context="weekly" />}
    </div>
  );
}

function VersionRow({ version }: { version: DemandPlanVersionListItem }) {
  const scopeLabel =
    version.versionName && version.versionName !== version.versionNo ? version.versionName : null;
  const detailSearch = buildDemandPlanVersionDetailSearch();
  const reviewSearch = buildDemandPlanVersionDetailSearch({ view: 'review' });

  return (
    <tr className="border-b border-border/60 align-top">
      <td className="p-2">
        {scopeLabel ? (
          <>
            <p className="text-sm font-medium text-text-main">{scopeLabel}</p>
            <p className="font-mono text-xs text-text-sub">{version.versionNo}</p>
          </>
        ) : (
          <p className="font-mono text-sm font-medium">{version.versionNo}</p>
        )}
      </td>
      <td className="p-2">
        <DemandPlanVersionStatusBadge status={version.status} />
      </td>
      <td className="p-2">
        <p>{formatDemandPlanProjectGroup(version.projectGroup)}</p>
        <p className="font-mono text-xs text-text-sub">{formatDemandPlanHorizon(version)}</p>
      </td>
      <td className="p-2 text-xs text-text-sub">
        <p>创建 {formatForecastDateTime(version.createdAt)}</p>
        {version.publishedAt ? <p>发布 {formatForecastDateTime(version.publishedAt)}</p> : null}
      </td>
      <td className="p-2">
        <div className="flex flex-wrap gap-2">
          <Link
            to={`/data/demand-plan/${version.id}${detailSearch}`}
            className="text-primary hover:underline"
          >
            查看
          </Link>
          {version.status === 'draft' ? (
            <Link
              to={`/data/demand-plan/${version.id}${reviewSearch}`}
              className="text-primary hover:underline"
            >
              去复核
            </Link>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
