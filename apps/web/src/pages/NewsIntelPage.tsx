import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/PageHeader';
import { ListPagination } from '@/components/ListPagination';
import { Button } from '@/components/ui/button';
import { formatDateTimeCst } from '@/lib/utils';

const STATUS_LABELS: Record<string, string> = {
  pending_review: '待审',
  published: '已发布',
  ignored: '已忽略',
  archived: '归档',
};

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
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [includeKw, setIncludeKw] = useState('');
  const [excludeKw, setExcludeKw] = useState('');
  const [showAddSource, setShowAddSource] = useState(false);
  const [newSource, setNewSource] = useState({
    code: '',
    name: '',
    feedUrl: '',
    sourceType: 'rss',
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
  });

  const { data: articles, isLoading } = useQuery({
    queryKey: ['news-intel-articles', page, statusFilter],
    queryFn: () =>
      api.getNewsIntelArticles({
        page,
        pageSize,
        status: statusFilter || undefined,
      }),
  });

  const { data: logs } = useQuery({
    queryKey: ['news-intel-logs'],
    queryFn: () => api.getNewsIngestLogs(20),
  });

  const triggerMutation = useMutation({
    mutationFn: (force?: boolean) => api.triggerNewsIngest({ force }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['news-intel-articles'] });
      void queryClient.invalidateQueries({ queryKey: ['news-intel-overview'] });
      void queryClient.invalidateQueries({ queryKey: ['news-intel-logs'] });
      void queryClient.invalidateQueries({ queryKey: ['news-intel-status'] });
    },
  });

  const publishMutation = useMutation({
    mutationFn: (id: string) => api.updateNewsIntelArticle(id, { status: 'published' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['news-intel-articles'] });
      void queryClient.invalidateQueries({ queryKey: ['news-intel-overview'] });
    },
  });

  const updateSourceMutation = useMutation({
    mutationFn: (params: {
      id: string;
      configJson: {
        includeKeywords?: string[];
        excludeKeywords?: string[];
        channel?: string;
        siteDomain?: string;
      };
      enabled?: boolean;
    }) => api.updateNewsIntelSource(params.id, { configJson: params.configJson, enabled: params.enabled }),
    onSuccess: () => {
      setEditingSourceId(null);
      void queryClient.invalidateQueries({ queryKey: ['news-intel-sources'] });
    },
  });

  const createSourceMutation = useMutation({
    mutationFn: () =>
      api.createNewsIntelSource({
        code: newSource.code.trim(),
        name: newSource.name.trim(),
        feedUrl: newSource.feedUrl.trim(),
        sourceType: newSource.sourceType,
        configJson: {
          channel: 'media',
          siteDomain: newSource.siteDomain.trim() || undefined,
          includeKeywords: parseKeywords(newSource.includeKeywords),
        },
      }),
    onSuccess: () => {
      setShowAddSource(false);
      setNewSource({ code: '', name: '', feedUrl: '', sourceType: 'rss', siteDomain: '', includeKeywords: '' });
      void queryClient.invalidateQueries({ queryKey: ['news-intel-sources'] });
    },
  });

  const items = articles?.items ?? [];
  const total = articles?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader title="跨境资讯">
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={triggerMutation.isPending}
            onClick={() => triggerMutation.mutate(false)}
          >
            采集到期信源
          </Button>
          <Button disabled={triggerMutation.isPending} onClick={() => triggerMutation.mutate(true)}>
            强制全量采集
          </Button>
        </div>
      </PageHeader>
      <p className="-mt-4 mb-2 text-sm text-text-sub">
        OpenClaw 规则：国家过滤 · 否定词 · 5 类分类 · 7 天窗口 · 信源可配关键词
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
            <CardTitle className="text-sm font-normal text-text-sub">待审核</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview?.pendingReview ?? 0}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-normal text-text-sub">今日高优</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold">{overview?.highPriorityToday ?? 0}</CardContent>
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
          <CardTitle>全局策略</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-text-sub">
          <p>时间窗口：最近 {policy?.lookbackDays ?? 7} 天</p>
          <p>启用通道：{Object.values(policy?.channels ?? {}).filter((c) => c.enabled).map((c) => c.label).join('、') || '-'}</p>
          <p>分类体系：{policy?.categories?.map((c) => c.bitableValue).join(' / ') ?? '-'}</p>
          <p>否定词：{policy?.negativeKeywords?.slice(0, 6).join('、')}{(policy?.negativeKeywords?.length ?? 0) > 6 ? '…' : ''}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>信源列表（可配置关键词）</CardTitle>
          <Button size="sm" variant="outline" onClick={() => setShowAddSource((v) => !v)}>
            {showAddSource ? '取消' : '新增信源'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {showAddSource && (
            <div className="grid gap-2 rounded border border-border p-3 md:grid-cols-2">
              <input className="rounded border px-2 py-1 text-sm" placeholder="code" value={newSource.code} onChange={(e) => setNewSource({ ...newSource, code: e.target.value })} />
              <input className="rounded border px-2 py-1 text-sm" placeholder="名称" value={newSource.name} onChange={(e) => setNewSource({ ...newSource, name: e.target.value })} />
              <input className="rounded border px-2 py-1 text-sm md:col-span-2" placeholder="RSS URL" value={newSource.feedUrl} onChange={(e) => setNewSource({ ...newSource, feedUrl: e.target.value })} />
              <input className="rounded border px-2 py-1 text-sm" placeholder="站点域名（可选）" value={newSource.siteDomain} onChange={(e) => setNewSource({ ...newSource, siteDomain: e.target.value })} />
              <input className="rounded border px-2 py-1 text-sm" placeholder="包含关键词，逗号分隔" value={newSource.includeKeywords} onChange={(e) => setNewSource({ ...newSource, includeKeywords: e.target.value })} />
              <Button className="md:col-span-2" size="sm" disabled={createSourceMutation.isPending} onClick={() => createSourceMutation.mutate()}>
                保存信源
              </Button>
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">名称</th>
                <th className="p-2 font-normal">通道/域名</th>
                <th className="p-2 font-normal">关键词</th>
                <th className="p-2 font-normal">状态</th>
                <th className="p-2 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {(sources?.items ?? []).map((s) => (
                <tr key={s.id} className="border-b border-border/60 align-top">
                  <td className="p-2">
                    <div className="font-medium text-text-main">{s.name}</div>
                    <div className="text-xs text-text-hint">{s.code} · {s.sourceType}</div>
                  </td>
                  <td className="p-2 text-xs text-text-sub">
                    {s.configJson?.channel ?? 'media'}
                    {s.configJson?.siteDomain ? ` · ${s.configJson.siteDomain}` : ''}
                  </td>
                  <td className="p-2 text-xs text-text-sub">
                    {editingSourceId === s.id ? (
                      <div className="space-y-1">
                        <input className="w-full rounded border px-1 py-0.5" placeholder="包含关键词" value={includeKw} onChange={(e) => setIncludeKw(e.target.value)} />
                        <input className="w-full rounded border px-1 py-0.5" placeholder="排除关键词" value={excludeKw} onChange={(e) => setExcludeKw(e.target.value)} />
                      </div>
                    ) : (
                      <>
                        <div>含：{keywordsToText(s.configJson?.includeKeywords) || '-'}</div>
                        <div>排：{keywordsToText(s.configJson?.excludeKeywords) || '-'}</div>
                      </>
                    )}
                  </td>
                  <td className="p-2">{s.enabled ? '启用' : '停用'}</td>
                  <td className="p-2">
                    {editingSourceId === s.id ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            updateSourceMutation.mutate({
                              id: s.id,
                              configJson: {
                                ...s.configJson,
                                channel: s.configJson?.channel ?? 'media',
                                includeKeywords: parseKeywords(includeKw),
                                excludeKeywords: parseKeywords(excludeKw),
                              },
                            })
                          }
                        >
                          保存
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingSourceId(null)}>
                          取消
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingSourceId(s.id);
                          setIncludeKw(keywordsToText(s.configJson?.includeKeywords));
                          setExcludeKw(keywordsToText(s.configJson?.excludeKeywords));
                        }}
                      >
                        编辑
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>文章列表</CardTitle>
          <select
            className="rounded border border-border bg-background px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">全部状态</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-text-sub">加载中...</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-2 font-normal">标题</th>
                    <th className="p-2 font-normal">Bitable分类</th>
                    <th className="p-2 font-normal">相关度</th>
                    <th className="p-2 font-normal">状态</th>
                    <th className="p-2 font-normal">来源</th>
                    <th className="p-2 font-normal">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className="border-b border-border/60 align-top">
                      <td className="p-2 max-w-md">
                        <a href={a.canonicalUrl} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">
                          {a.title}
                        </a>
                        <p className="mt-1 line-clamp-2 text-xs text-text-hint">{a.summary}</p>
                      </td>
                      <td className="p-2">{(a as { bitableCategory?: string }).bitableCategory ?? '-'}</td>
                      <td className="p-2">{a.relevanceScore}</td>
                      <td className="p-2">{STATUS_LABELS[a.status] ?? a.status}</td>
                      <td className="p-2 text-text-sub">{a.sourceName}</td>
                      <td className="p-2">
                        {a.status === 'pending_review' && (
                          <Button size="sm" variant="outline" disabled={publishMutation.isPending} onClick={() => publishMutation.mutate(a.id)}>
                            发布
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!items.length && (
                    <tr>
                      <td colSpan={6} className="p-4 text-center text-text-hint">
                        暂无文章
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <ListPagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} />
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>采集日志</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">时间</th>
                <th className="p-2 font-normal">信源</th>
                <th className="p-2 font-normal">拉取</th>
                <th className="p-2 font-normal">新增</th>
                <th className="p-2 font-normal">去重</th>
                <th className="p-2 font-normal">过滤</th>
                <th className="p-2 font-normal">耗时</th>
              </tr>
            </thead>
            <tbody>
              {(logs?.items ?? []).map((row) => (
                <tr key={row.log.id} className="border-b border-border/60">
                  <td className="p-2 text-text-sub">{formatTime(row.log.createdAt)}</td>
                  <td className="p-2">{row.sourceName}</td>
                  <td className="p-2">{row.log.fetchedCount}</td>
                  <td className="p-2">{row.log.newCount}</td>
                  <td className="p-2">{row.log.skippedDup}</td>
                  <td className="p-2">{row.log.skippedLowRelevance}</td>
                  <td className="p-2">{row.log.durationMs ?? '-'}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
