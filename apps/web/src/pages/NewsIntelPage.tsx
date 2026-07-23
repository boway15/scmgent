import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { Button } from '@/components/ui/button';
import { cn, formatDateTimeCst } from '@/lib/utils';

const SYNC_LABELS: Record<string, string> = {
  pending: '待同步',
  synced: '已同步',
  failed: '同步失败',
};

const TIER_LABELS: Record<string, string> = {
  tier_1: '一级',
  tier_2: '二级',
  tier_3: '三级',
};

const TIER_HELP = [
  {
    tier: '一级',
    meaning: '官方一手来源',
    detail:
      '法规、平台规则、物流与重大外部事件的权威渠道（海关/税务/平台卖家中心/港口航运等）。英文一级源可入库并翻译为简体中文，保留原文与官方标识；可信度权重最高。',
  },
  {
    tier: '二级',
    meaning: '中文垂直媒体',
    detail:
      '跨境电商、家具家居、供应链物流、营销与 AI 等行业媒体，用于补充背景信息；事实宜尽量可追溯到原始来源。',
  },
  {
    tier: '三级',
    meaning: '经验证的聚合信源',
    detail:
      'RSSHub 等稳定聚合源，主要用于发现线索；需经过更严格的业务相关性、可信度与去重校验后才能入表。',
  },
] as const;

type TabKey = 'articles' | 'logs' | 'sources';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'articles', label: '最近入库' },
  { key: 'logs', label: '采集日志' },
  { key: 'sources', label: '信源配置' },
];

function parseKeywords(text: string): string[] {
  return text
    .split(/[,，\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function keywordsToText(list?: string[]): string {
  return list?.join(', ') ?? '';
}

function formatTime(value?: string | null): string {
  if (!value) return '-';
  return formatDateTimeCst(value);
}

export function NewsIntelPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('articles');
  const [page, setPage] = useState(1);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [includeKw, setIncludeKw] = useState('');
  const [excludeKw, setExcludeKw] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSource, setNewSource] = useState({
    code: '',
    name: '',
    feedUrl: '',
    sourceType: 'rss',
    sourceTier: 'tier_2',
    isOfficial: false,
    sourceLanguage: 'zh',
    siteDomain: '',
    includeKeywords: '',
  });
  const pageSize = 20;

  const { data: status } = useQuery({
    queryKey: ['news-intel-status'],
    queryFn: () => api.getNewsIntelStatus(),
  });

  const { data: overview } = useQuery({
    queryKey: ['news-intel-overview'],
    queryFn: () => api.getNewsIntelOverview(),
  });

  const { data: policy } = useQuery({
    queryKey: ['news-intel-policy'],
    queryFn: () => api.getNewsIntelPolicy(),
  });

  const { data: sources } = useQuery({
    queryKey: ['news-intel-sources'],
    queryFn: () => api.getNewsIntelSources(),
    enabled: tab === 'sources',
  });

  const { data: articles, isLoading } = useQuery({
    queryKey: ['news-intel-articles', page],
    queryFn: () =>
      api.getNewsIntelArticles({
        page,
        pageSize,
      }),
    enabled: tab === 'articles',
  });

  const { data: logs } = useQuery({
    queryKey: ['news-intel-logs'],
    queryFn: () => api.getNewsIngestLogs(20),
    enabled: tab === 'logs',
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['news-intel-articles'] });
    void queryClient.invalidateQueries({ queryKey: ['news-intel-overview'] });
    void queryClient.invalidateQueries({ queryKey: ['news-intel-logs'] });
    void queryClient.invalidateQueries({ queryKey: ['news-intel-status'] });
    void queryClient.invalidateQueries({ queryKey: ['news-intel-sources'] });
  };

  const triggerMutation = useMutation({
    mutationFn: (force?: boolean) => api.triggerNewsIngest({ force }),
    onSuccess: invalidateAll,
  });

  const syncMutation = useMutation({
    mutationFn: (id: string) => api.syncNewsIntelArticleBitable(id),
    onSuccess: invalidateAll,
  });

  const updateSourceMutation = useMutation({
    mutationFn: (params: {
      id: string;
      configJson: Record<string, unknown>;
      enabled?: boolean;
      sourceTier?: string;
      isOfficial?: boolean;
      sourceLanguage?: string;
    }) =>
      api.updateNewsIntelSource(params.id, {
        configJson: params.configJson,
        enabled: params.enabled,
        sourceTier: params.sourceTier,
        isOfficial: params.isOfficial,
        sourceLanguage: params.sourceLanguage,
      }),
    onSuccess: () => {
      setEditingSourceId(null);
      invalidateAll();
    },
  });

  const createSourceMutation = useMutation({
    mutationFn: () =>
      api.createNewsIntelSource({
        code: newSource.code.trim(),
        name: newSource.name.trim(),
        feedUrl: newSource.feedUrl.trim(),
        sourceType: newSource.sourceType,
        sourceTier: newSource.sourceTier,
        isOfficial: newSource.isOfficial,
        sourceLanguage: newSource.sourceLanguage,
        configJson: {
          siteDomain: newSource.siteDomain.trim() || undefined,
          includeKeywords: parseKeywords(newSource.includeKeywords),
          sourceTier: newSource.sourceTier,
          isOfficial: newSource.isOfficial,
          language: newSource.sourceLanguage,
        },
      }),
    onSuccess: () => {
      setShowAddSource(false);
      setNewSource({
        code: '',
        name: '',
        feedUrl: '',
        sourceType: 'rss',
        sourceTier: 'tier_2',
        isOfficial: false,
        sourceLanguage: 'zh',
        siteDomain: '',
        includeKeywords: '',
      });
      invalidateAll();
    },
  });

  const items = articles?.items ?? [];
  const total = articles?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="跨境资讯采集">
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={triggerMutation.isPending}
            onClick={() => triggerMutation.mutate(false)}
          >
            执行今日采集
          </Button>
          <Button disabled={triggerMutation.isPending} onClick={() => triggerMutation.mutate(true)}>
            强制全量采集
          </Button>
        </div>
      </PageHeader>
      <p className="-mt-4 mb-2 text-sm text-text-sub">
        家具跨境业务画像 · 九类主题 · 多标签分类 · 仅同步新飞书总表 · 不做群推送
      </p>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-text-sub">今日新增</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview?.todayNew ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-text-sub">待同步</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview?.pendingSync ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-text-sub">同步失败</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview?.syncFailed ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-text-sub">信源健康</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">
            {overview?.sourceHealthy ?? 0}/{overview?.sourceTotal ?? 0}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">运行状态</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-text-sub">
          <div>模块启用：{status?.enabled ? '是' : '否'}</div>
          <div>
            飞书 V2 表：
            {status?.bitableConfigured
              ? status.bitableTableId
              : '未配置 FEISHU_BITABLE_TABLE_NEWS_INTEL_V2'}
          </div>
          <div>RSSHub：{status?.rsshubConfigured ? '已配置' : '未配置（rsshub 信源已自动停用）'}</div>
          <div>
            中文 enrichment（Dify）：
            {status?.enrichConfigured
              ? '已配置（可选增强）'
              : '未配置（英文原文入表，翻译可在飞书表 AI 字段完成）'}
          </div>
          <div>
            最近任务：{status?.latestRun?.status ?? '-'} · {formatTime(status?.latestRun?.startedAt)}
          </div>
          <div>
            策略只读：回看 {policy?.lookbackDays ?? '-'} 天 · 每源最多 {policy?.maxItemsPerSource ?? '-'}{' '}
            条 · 主题 {policy?.topics?.length ?? 0} · 品牌 {policy?.brandKeywords?.length ?? 0}
          </div>
        </CardContent>
      </Card>

      <nav className="flex gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cn(
              'relative -mb-px border-b-2 px-4 py-2.5 text-sm transition-colors',
              tab === item.key
                ? 'border-primary font-medium text-primary'
                : 'border-transparent text-text-sub hover:text-text-main',
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === 'articles' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">最近入库</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-sm text-text-sub">加载中…</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] table-fixed text-sm">
                  <colgroup>
                    <col style={{ width: '34%' }} />
                    <col style={{ width: '14%' }} />
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '16%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '96px' }} />
                  </colgroup>
                  <thead>
                    <tr className="border-b text-left text-text-sub">
                      <th className="px-2 py-2">中文标题</th>
                      <th className="px-2 py-2">主题/部门</th>
                      <th className="px-2 py-2">标签</th>
                      <th className="px-2 py-2">信源</th>
                      <th className="px-2 py-2">同步</th>
                      <th className="px-2 py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id} className="border-b align-top">
                        <td className="px-2 py-2">
                          <a
                            className="line-clamp-2 font-medium text-primary hover:underline"
                            href={item.canonicalUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={item.titleZh ?? item.title}
                          >
                            {item.titleZh ?? item.title}
                          </a>
                          {item.titleOriginal && item.titleOriginal !== item.titleZh && (
                            <div
                              className="mt-0.5 truncate text-xs text-text-hint"
                              title={item.titleOriginal}
                            >
                              {item.titleOriginal}
                            </div>
                          )}
                          <div className="mt-0.5 font-mono text-xs text-text-hint">
                            {formatTime(item.fetchedAt)}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div
                            className="truncate"
                            title={item.topicCategory ?? item.bitableCategory ?? '-'}
                          >
                            {item.topicCategory ?? item.bitableCategory ?? '-'}
                          </div>
                          <div
                            className="truncate text-xs text-text-hint"
                            title={(item.departments ?? []).join('、') || '-'}
                          >
                            {(item.departments ?? []).join('、') || '-'}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-xs leading-snug">
                          <div
                            className="truncate"
                            title={(item.platformTags ?? []).join('、') || '-'}
                          >
                            平台:{(item.platformTags ?? []).join('、') || '-'}
                          </div>
                          <div
                            className="truncate"
                            title={(item.countryTags ?? []).join('、') || '-'}
                          >
                            国家:{(item.countryTags ?? []).join('、') || '-'}
                          </div>
                          <div className="truncate" title={(item.brandTags ?? []).join('、') || '-'}>
                            品牌:{(item.brandTags ?? []).join('、') || '-'}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="truncate" title={item.sourceName}>
                            {item.sourceName}
                          </div>
                          <div className="truncate text-xs text-text-hint">
                            {TIER_LABELS[item.sourceTier ?? 'tier_2']} · {item.language ?? 'zh'} ·
                            相关度 {item.relevanceScore}
                          </div>
                        </td>
                        <td className="px-2 py-2">
                          <div className="whitespace-nowrap">
                            {SYNC_LABELS[item.bitableSyncStatus ?? 'pending'] ??
                              item.bitableSyncStatus}
                          </div>
                          {item.bitableSyncError && (
                            <div
                              className="mt-0.5 truncate text-xs text-red-600"
                              title={item.bitableSyncError}
                            >
                              {item.bitableSyncError}
                            </div>
                          )}
                        </td>
                        <td className="px-2 py-2">
                          {(item.bitableSyncStatus === 'failed' ||
                            item.bitableSyncStatus === 'pending') && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={syncMutation.isPending}
                              onClick={() => syncMutation.mutate(item.id)}
                            >
                              重试同步
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ListPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'logs' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">采集日志</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(logs?.items ?? []).length === 0 ? (
              <div className="text-text-sub">暂无采集日志</div>
            ) : (
              (logs?.items ?? []).map((row) => (
                <div key={row.log.id} className="rounded border px-3 py-2">
                  <div className="font-medium">
                    {row.sourceName} · {formatTime(row.log.createdAt)}
                  </div>
                  <div className="text-text-sub">
                    抓取 {row.log.fetchedCount} / 新增 {row.log.newCount} / 去重 {row.log.skippedDup}{' '}
                    / 过滤 {row.log.skippedFiltered ?? 0} / 翻译 {row.log.translatedCount ?? 0} /
                    同步失败 {row.log.bitableSyncFailedCount ?? 0}
                  </div>
                  {row.log.errorMessage && (
                    <div
                      className={
                        row.log.errorMessage.startsWith('filterReasons:')
                          ? 'text-amber-700'
                          : 'text-red-600'
                      }
                    >
                      {row.log.errorMessage}
                    </div>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {tab === 'sources' && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">信源配置</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setShowAddSource((v) => !v)}>
              {showAddSource ? '取消' : '新增信源'}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-md border border-border bg-muted/20 px-3 py-3 text-sm">
              <div className="mb-2 font-medium text-text-main">等级含义</div>
              <ul className="space-y-2 text-text-sub">
                {TIER_HELP.map((item) => (
                  <li key={item.tier}>
                    <span className="font-medium text-text-main">
                      {item.tier}（{item.meaning}）
                    </span>
                    ：{item.detail}
                  </li>
                ))}
              </ul>
            </div>

            {showAddSource && (
              <div className="grid gap-2 rounded border p-3 md:grid-cols-3">
                <input
                  className="rounded border px-2 py-1 text-sm"
                  placeholder="code"
                  value={newSource.code}
                  onChange={(e) => setNewSource({ ...newSource, code: e.target.value })}
                />
                <input
                  className="rounded border px-2 py-1 text-sm"
                  placeholder="名称"
                  value={newSource.name}
                  onChange={(e) => setNewSource({ ...newSource, name: e.target.value })}
                />
                <input
                  className="rounded border px-2 py-1 text-sm md:col-span-2"
                  placeholder="RSS URL"
                  value={newSource.feedUrl}
                  onChange={(e) => setNewSource({ ...newSource, feedUrl: e.target.value })}
                />
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={newSource.sourceTier}
                  onChange={(e) => setNewSource({ ...newSource, sourceTier: e.target.value })}
                >
                  <option value="tier_1">一级 · 官方一手</option>
                  <option value="tier_2">二级 · 垂直媒体</option>
                  <option value="tier_3">三级 · 聚合线索</option>
                </select>
                <select
                  className="rounded border px-2 py-1 text-sm"
                  value={newSource.sourceLanguage}
                  onChange={(e) => setNewSource({ ...newSource, sourceLanguage: e.target.value })}
                >
                  <option value="zh">中文</option>
                  <option value="en">英文</option>
                </select>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={newSource.isOfficial}
                    onChange={(e) => setNewSource({ ...newSource, isOfficial: e.target.checked })}
                  />
                  官方来源
                </label>
                <input
                  className="rounded border px-2 py-1 text-sm md:col-span-2"
                  placeholder="包含关键词，逗号分隔"
                  value={newSource.includeKeywords}
                  onChange={(e) => setNewSource({ ...newSource, includeKeywords: e.target.value })}
                />
                <Button
                  size="sm"
                  disabled={createSourceMutation.isPending}
                  onClick={() => createSourceMutation.mutate()}
                >
                  保存
                </Button>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1040px] table-fixed text-sm">
                <colgroup>
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '28%' }} />
                  <col style={{ width: '56px' }} />
                  <col style={{ width: '52px' }} />
                  <col style={{ width: '52px' }} />
                  <col style={{ width: '56px' }} />
                  <col style={{ width: '150px' }} />
                  <col style={{ width: '148px' }} />
                </colgroup>
                <thead>
                  <tr className="border-b text-left text-text-sub">
                    <th className="px-2 py-2">名称</th>
                    <th className="px-2 py-2">RSS URL</th>
                    <th className="px-2 py-2">等级</th>
                    <th className="px-2 py-2">语言</th>
                    <th className="px-2 py-2">官方</th>
                    <th className="px-2 py-2">状态</th>
                    <th className="px-2 py-2">最近采集</th>
                    <th className="px-2 py-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(sources?.items ?? []).map((source) => (
                    <tr key={source.id} className="border-b align-middle">
                      <td className="px-2 py-2">
                        <div className="truncate font-medium" title={source.name}>
                          {source.name}
                        </div>
                        <div className="truncate text-xs text-text-hint" title={source.code}>
                          {source.code}
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        {source.feedUrl ? (
                          <a
                            className="block truncate font-mono text-xs text-primary hover:underline"
                            href={source.feedUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={source.feedUrl}
                          >
                            {source.feedUrl}
                          </a>
                        ) : (
                          <span className="text-xs text-text-hint">-</span>
                        )}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        <span
                          title={
                            TIER_HELP.find(
                              (t) => t.tier === TIER_LABELS[source.sourceTier ?? 'tier_2'],
                            )?.detail
                          }
                        >
                          {TIER_LABELS[source.sourceTier ?? 'tier_2']}
                        </span>
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {source.sourceLanguage ?? 'zh'}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {source.isOfficial ? '是' : '否'}
                      </td>
                      <td className="px-2 py-2 whitespace-nowrap">
                        {source.enabled ? '启用' : '停用'}
                      </td>
                      <td className="px-2 py-2">
                        <div className="font-mono text-xs whitespace-nowrap">
                          {formatTime(source.lastFetchedAt)}
                        </div>
                        {source.lastError && (
                          <div
                            className="mt-0.5 truncate text-xs text-red-600"
                            title={source.lastError}
                          >
                            {source.lastError}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">
                        {editingSourceId === source.id ? (
                          <div className="space-y-2">
                            <textarea
                              className="w-full rounded border px-2 py-1 text-xs"
                              rows={2}
                              value={includeKw}
                              onChange={(e) => setIncludeKw(e.target.value)}
                              placeholder="包含关键词"
                            />
                            <textarea
                              className="w-full rounded border px-2 py-1 text-xs"
                              rows={2}
                              value={excludeKw}
                              onChange={(e) => setExcludeKw(e.target.value)}
                              placeholder="排除关键词"
                            />
                            <div className="flex flex-wrap gap-1.5">
                              <Button
                                size="sm"
                                onClick={() =>
                                  updateSourceMutation.mutate({
                                    id: source.id,
                                    configJson: {
                                      ...(source.configJson ?? {}),
                                      includeKeywords: parseKeywords(includeKw),
                                      excludeKeywords: parseKeywords(excludeKw),
                                    },
                                  })
                                }
                              >
                                保存
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingSourceId(null)}
                              >
                                取消
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditingSourceId(source.id);
                                setIncludeKw(keywordsToText(source.configJson?.includeKeywords));
                                setExcludeKw(keywordsToText(source.configJson?.excludeKeywords));
                              }}
                            >
                              关键词
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                updateSourceMutation.mutate({
                                  id: source.id,
                                  enabled: !source.enabled,
                                  configJson: source.configJson ?? {},
                                })
                              }
                            >
                              {source.enabled ? '停用' : '启用'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
