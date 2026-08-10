import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { filterEntities, momPct, sumSeries, yoyPct } from '@/lib/sales-analytics-metrics';
import type {
  SalesAnalyticsGranularity,
  SalesAnalyticsSelection,
} from '@/lib/sales-analytics-types';
import { cn, formatDateTimeCst } from '@/lib/utils';

const CHART_PRIMARY = '#FF5000';
const CHART_SECONDARY = '#D97706';
const CHART_HIGHLIGHT = '#F59E0B';

const DIM_META: Array<{
  key: keyof SalesAnalyticsSelection;
  label: string;
  metaKey: 'sites' | 'depts' | 'categories' | 'platforms';
}> = [
  { key: 's', label: '站点', metaKey: 'sites' },
  { key: 'b', label: '组别', metaKey: 'depts' },
  { key: 'c', label: '品类', metaKey: 'categories' },
  { key: 'p', label: '平台', metaKey: 'platforms' },
];

function fmtQty(n: number): string {
  return Math.round(n).toLocaleString('zh-CN');
}

function fmtPct(n: number | null): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}%`;
}

function pctTone(n: number | null): string {
  if (n == null) return 'text-text-main';
  if (n > 0) return 'text-red-600';
  if (n < 0) return 'text-green-600';
  return 'text-text-main';
}

function selectionFromMeta(meta: {
  sites: string[];
  depts: string[];
  categories: string[];
  platforms: string[];
}): SalesAnalyticsSelection {
  return {
    s: new Set(meta.sites),
    b: new Set(meta.depts),
    c: new Set(meta.categories),
    p: new Set(meta.platforms),
  };
}

function DimMultiSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((o) => o.toLowerCase().includes(needle));
  }, [options, q]);

  const summary =
    selected.size === 0
      ? '未选'
      : selected.size === options.length
        ? '全部'
        : `已选 ${selected.size}`;

  return (
    <div className="relative min-w-[180px]">
      <p className="mb-1 text-sm text-text-sub">{label}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full justify-between font-normal"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="truncate">{summary}</span>
        <span className="text-text-hint">▾</span>
      </Button>
      {open && (
        <div className="absolute z-30 mt-1 w-56 rounded-md border border-border bg-card p-2 shadow-card">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="输入查找…"
            className="mb-2 h-8 text-xs"
          />
          <div className="mb-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange(new Set(options))}
            >
              全选
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onChange(new Set())}
            >
              清空
            </Button>
          </div>
          <div className="max-h-56 overflow-auto">
            {filtered.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selected.has(opt)}
                  onChange={() => {
                    const next = new Set(selected);
                    if (next.has(opt)) next.delete(opt);
                    else next.add(opt);
                    onChange(next);
                  }}
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="px-1 py-2 text-xs text-text-hint">无匹配项</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function SalesAnalyticsPage() {
  const qc = useQueryClient();
  const [gran, setGran] = useState<SalesAnalyticsGranularity>('month');
  const [sel, setSel] = useState<SalesAnalyticsSelection | null>(null);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(0);
  const [cubeKey, setCubeKey] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['sales-analytics-status'],
    queryFn: () => api.getSalesAnalyticsStatus(),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });

  const hasReadyCube = Boolean(statusQuery.data?.generatedAt ?? statusQuery.data?.meta);
  const rebuilding = Boolean(statusQuery.data?.running);

  const cubeQuery = useQuery({
    queryKey: ['sales-analytics-cube', statusQuery.data?.generatedAt],
    queryFn: () => api.getSalesAnalyticsCube(),
    enabled: hasReadyCube && !rebuilding,
    retry: false,
  });

  useEffect(() => {
    const cube = cubeQuery.data;
    if (!cube) return;
    const key = cube.meta.generatedAt;
    if (key === cubeKey) return;
    setCubeKey(key);
    setSel(selectionFromMeta(cube.meta));
    const periods = gran === 'week' ? cube.weeks : cube.months;
    setRangeStart(0);
    setRangeEnd(Math.max(0, periods.length - 1));
  }, [cubeQuery.data, cubeKey, gran]);

  useEffect(() => {
    const cube = cubeQuery.data;
    if (!cube) return;
    const periods = gran === 'week' ? cube.weeks : cube.months;
    setRangeStart(0);
    setRangeEnd(Math.max(0, periods.length - 1));
  }, [gran, cubeQuery.data?.months.length, cubeQuery.data?.weeks.length]);

  const rebuild = useMutation({
    mutationFn: () => api.rebuildSalesAnalyticsCube(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sales-analytics-status'] });
      await qc.invalidateQueries({ queryKey: ['sales-analytics-cube'] });
    },
    onError: async () => {
      await qc.invalidateQueries({ queryKey: ['sales-analytics-status'] });
    },
  });

  const busy = rebuild.isPending || rebuilding;

  const cube = cubeQuery.data;
  const periods = cube ? (gran === 'week' ? cube.weeks : cube.months) : [];
  const safeStart = Math.min(rangeStart, Math.max(0, periods.length - 1));
  const safeEnd = Math.min(Math.max(rangeEnd, safeStart), Math.max(0, periods.length - 1));

  const filtered = useMemo(() => {
    if (!cube || !sel) return [];
    return filterEntities(cube.data, sel);
  }, [cube, sel]);

  const series = useMemo(() => sumSeries(filtered, gran), [filtered, gran]);

  const chartRows = useMemo(() => {
    if (!periods.length || !series.length) return [];
    return periods.slice(safeStart, safeEnd + 1).map((period, offset) => {
      const i = safeStart + offset;
      return {
        period,
        qty: series[i] ?? 0,
        mom: momPct(series, i),
        yoy: yoyPct(series, periods, i),
        isLatest: i === safeEnd,
      };
    });
  }, [periods, series, safeStart, safeEnd]);

  const latestIdx = safeEnd;
  const latestQty = series[latestIdx] ?? 0;
  const latestMom = series.length ? momPct(series, latestIdx) : null;
  const latestYoy = series.length ? yoyPct(series, periods, latestIdx) : null;
  const rangeCum = series.slice(safeStart, safeEnd + 1).reduce((a, b) => a + b, 0);

  const generatedAt = cube?.meta.generatedAt ?? statusQuery.data?.generatedAt ?? null;
  const subtitle = generatedAt
    ? `数据生成于 ${formatDateTimeCst(generatedAt)} · 记录 ${cube?.meta.recordCount?.toLocaleString('zh-CN') ?? '—'} 条`
    : '尚未生成看板 Cube，请先生成数据';

  if (statusQuery.isLoading) {
    return <p className="text-text-sub">加载中...</p>;
  }

  if (statusQuery.isError) {
    return (
      <div className="space-y-4">
        <PageHeader title="销售分析看板" />
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-red-600">
              状态加载失败：{statusQuery.error instanceof Error ? statusQuery.error.message : '未知错误'}
            </p>
            <Button type="button" onClick={() => statusQuery.refetch()}>
              重试
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="销售分析看板">
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="text-sm text-text-sub">{subtitle}</p>
          <Button type="button" disabled={busy} onClick={() => rebuild.mutate()}>
            {busy ? '生成中…' : hasReadyCube ? '刷新看板数据' : '生成看板数据'}
          </Button>
        </div>
      </PageHeader>

      {statusQuery.data?.errorMessage && !hasReadyCube && (
        <p className="text-sm text-red-600">上次生成失败：{statusQuery.data.errorMessage}</p>
      )}

      {!hasReadyCube && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-text-sub">
              暂无可用看板数据。点击「生成看板数据」将从日销量历史预聚合四维 Cube（站点 / 组别 / 品类 / 平台）。
            </p>
            <Button type="button" disabled={busy} onClick={() => rebuild.mutate()}>
              {busy ? '生成中…' : '生成看板数据'}
            </Button>
          </CardContent>
        </Card>
      )}

      {hasReadyCube && cubeQuery.isLoading && (
        <p className="text-text-sub">正在加载看板数据…</p>
      )}

      {hasReadyCube && cubeQuery.isError && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <p className="text-sm text-red-600">
              Cube 加载失败：{cubeQuery.error instanceof Error ? cubeQuery.error.message : '未知错误'}
            </p>
            <Button type="button" variant="outline" onClick={() => cubeQuery.refetch()}>
              重试加载
            </Button>
          </CardContent>
        </Card>
      )}

      {cube && sel && (
        <>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {(
              [
                ['month', '月度分析'],
                ['week', '周度分析'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={cn(
                  'px-4 py-2 text-sm font-medium transition-colors',
                  gran === value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-card text-text-sub hover:bg-muted',
                )}
                onClick={() => setGran(value)}
              >
                {label}
              </button>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">分析维度与筛选</CardTitle>
              <p className="text-sm text-text-sub">
                四维多选默认全选；任一维清空则无命中行。期段按{gran === 'week' ? '周' : '月'}起止过滤 KPI 与图表。
              </p>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              {DIM_META.map((dim) => (
                <DimMultiSelect
                  key={dim.key}
                  label={`${dim.label}筛选`}
                  options={cube.meta[dim.metaKey]}
                  selected={sel[dim.key]}
                  onChange={(next) => setSel((prev) => (prev ? { ...prev, [dim.key]: next } : prev))}
                />
              ))}
              <div className="min-w-[220px]">
                <p className="mb-1 text-sm text-text-sub">
                  期段筛选（{gran === 'week' ? '周' : '月'}起 → 止）
                </p>
                <div className="flex items-center gap-2">
                  <select
                    className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                    value={safeStart}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRangeStart(v);
                      if (v > safeEnd) setRangeEnd(v);
                    }}
                  >
                    {periods.map((p, i) => (
                      <option key={p} value={i}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <span className="text-text-sub">→</span>
                  <select
                    className="h-9 rounded-md border border-input bg-card px-2 text-sm"
                    value={safeEnd}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setRangeEnd(v);
                      if (v < safeStart) setRangeStart(v);
                    }}
                  >
                    {periods.map((p, i) => (
                      <option key={p} value={i}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {[
              {
                label: `最新期（${periods[latestIdx] ?? '—'}）销量`,
                value: fmtQty(latestQty),
                className: 'text-text-main',
              },
              {
                label: '最新期 环比 MoM',
                value: fmtPct(latestMom),
                className: pctTone(latestMom),
              },
              {
                label: '最新期 同比 YoY',
                value: fmtPct(latestYoy),
                className: pctTone(latestYoy),
              },
              {
                label: '区间累计销量',
                value: fmtQty(rangeCum),
                className: 'text-text-main',
              },
              {
                label: '命中实体数',
                value: filtered.length.toLocaleString('zh-CN'),
                className: 'text-text-main',
              },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardContent className="pt-6">
                  <p className="text-sm text-text-sub">{kpi.label}</p>
                  <p className={cn('mt-1 text-2xl font-semibold', kpi.className)}>{kpi.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {gran === 'week' ? '周度' : '月度'}销量总量（件）
                </CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {chartRows.some((r) => r.qty > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartRows}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value) => [`${fmtQty(Number(value ?? 0))} 件`, '销量']}
                      />
                      <Bar dataKey="qty" name="销量" radius={[4, 4, 0, 0]}>
                        {chartRows.map((row) => (
                          <Cell
                            key={row.period}
                            fill={row.isLatest ? CHART_HIGHLIGHT : CHART_PRIMARY}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="flex h-full items-center justify-center text-sm text-text-hint">
                    当前筛选无销量数据
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">增长幅度（%）</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                {chartRows.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartRows}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} unit="%" />
                      <Tooltip
                        formatter={(value, name) => [
                          value == null ? '—' : `${Number(value).toFixed(1)}%`,
                          String(name),
                        ]}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="mom"
                        name="环比 MoM"
                        stroke={CHART_PRIMARY}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="yoy"
                        name="同比 YoY"
                        stroke={CHART_SECONDARY}
                        strokeWidth={2}
                        dot={{ r: 2 }}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="flex h-full items-center justify-center text-sm text-text-hint">
                    当前筛选无增长数据
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
