import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DRAWER_HISTORY_MONTH_COUNT } from '@/lib/forecast-horizon-meta';
import { formatConfidenceLabel } from '@/lib/forecast-labels';

export type ForecastExogenousReason =
  | 'price_change'
  | 'ad'
  | 'promo'
  | 'listing_change'
  | 'other';

export type ExogenousFactorRow = {
  id: string;
  monthLabel: string;
  reason: ForecastExogenousReason;
  intensity: string;
  note: string;
};

const EXOGENOUS_REASON_OPTIONS: Array<{ value: ForecastExogenousReason; label: string }> = [
  { value: 'price_change', label: '调价' },
  { value: 'ad', label: '投广告' },
  { value: 'promo', label: '促销' },
  { value: 'listing_change', label: '上架变更' },
  { value: 'other', label: '其他' },
];

const formatFactor = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value.toFixed(2);

function newFactorRow(monthLabel: string): ExogenousFactorRow {
  return {
    id: crypto.randomUUID(),
    monthLabel,
    reason: 'price_change',
    intensity: '',
    note: '',
  };
}

type AiMonthlyItem = {
  monthLabel: string;
  forecastDailyAvg: number;
  confidence?: string;
  rationale?: string;
};

type Props = {
  skuCode: string;
  station: string;
  platform: string;
  versionId: string;
  horizonMonthCount: number;
  monthLabels: string[];
  profileSegment?: string | null;
};

export function ForecastAssistPanel({
  skuCode,
  station,
  platform,
  versionId,
  horizonMonthCount,
  monthLabels,
  profileSegment,
}: Props) {
  const qc = useQueryClient();
  const defaultMonth = monthLabels[0] ?? '';

  const { data: aiConfig } = useQuery({
    queryKey: ['ai-config'],
    queryFn: api.getAiConfig,
  });

  const [humanExpanded, setHumanExpanded] = useState(false);
  const [exogenousRows, setExogenousRows] = useState<ExogenousFactorRow[]>([]);
  const [operatorNote, setOperatorNote] = useState('');
  const [aiRationale, setAiRationale] = useState<string | null>(null);
  const [aiMonthlyResult, setAiMonthlyResult] = useState<AiMonthlyItem[] | null>(null);
  const [aiResultExpanded, setAiResultExpanded] = useState(false);
  const [lastAssistMode, setLastAssistMode] = useState<'auto' | 'human' | null>(null);

  const difyEnabled = Boolean(aiConfig?.salesForecastWorkflow);

  useEffect(() => {
    setExogenousRows([]);
    setOperatorNote('');
    setAiRationale(null);
    setAiMonthlyResult(null);
    setAiResultExpanded(false);
    setLastAssistMode(null);
    setHumanExpanded(false);
  }, [skuCode, station, platform, versionId]);

  const invalidateForecastQueries = async () => {
    await qc.invalidateQueries({ queryKey: ['sales-forecast-horizon'] });
    await qc.invalidateQueries({ queryKey: ['sales-forecast-horizon-row'] });
    await qc.invalidateQueries({ queryKey: ['sales-forecasts'] });
    await qc.invalidateQueries({ queryKey: ['sales-forecast-sku-detail'] });
    await qc.refetchQueries({ queryKey: ['sales-forecast-horizon-row'] });
  };

  const applyAiSuccess = async (data: {
    rationale: string;
    monthlyForecasts: AiMonthlyItem[];
  }) => {
    setAiRationale(
      data.rationale ||
        data.monthlyForecasts
          .map((m) => m.rationale)
          .filter(Boolean)
          .join('\n'),
    );
    setAiMonthlyResult(data.monthlyForecasts);
    setAiResultExpanded(true);
    await invalidateForecastQueries();
  };

  const aiAutoForecast = useMutation({
    mutationFn: () =>
      api.runDifySingleSkuForecast({
        skuCode,
        station,
        platform,
        versionId,
        monthCount: horizonMonthCount,
        assistMode: 'auto',
      }),
    onSuccess: async (data) => {
      setLastAssistMode('auto');
      await applyAiSuccess(data);
    },
  });

  const aiHumanForecast = useMutation({
    mutationFn: () => {
      const factors = exogenousRows
        .filter((row) => row.monthLabel)
        .map((row) => ({
          monthLabel: row.monthLabel,
          reason: row.reason,
          intensity: row.intensity.trim() ? Number(row.intensity) : undefined,
          note: row.note.trim() || undefined,
        }));
      return api.runDifySingleSkuForecast({
        skuCode,
        station,
        platform,
        versionId,
        monthCount: horizonMonthCount,
        assistMode: 'human',
        exogenousFactors: {
          factors,
          operatorNote: operatorNote.trim() || undefined,
        },
      });
    },
    onSuccess: async (data) => {
      setLastAssistMode('human');
      await applyAiSuccess(data);
    },
  });

  const systemRecompute = useMutation({
    mutationFn: () =>
      api.generateSalesForecastBaseline({
        skuCode,
        platform,
        monthCount: horizonMonthCount,
        targetVersionId: versionId,
      }),
    onSuccess: async () => {
      setLastAssistMode(null);
      setAiRationale(null);
      setAiMonthlyResult(null);
      await invalidateForecastQueries();
    },
  });

  const aiPending = aiAutoForecast.isPending || aiHumanForecast.isPending;
  const aiMutation = aiHumanForecast.isPending ? aiHumanForecast : aiAutoForecast;
  const humanSubmitDisabled =
    !difyEnabled ||
    aiPending ||
    systemRecompute.isPending ||
    (exogenousRows.length === 0 && !operatorNote.trim());

  const hasAiResult =
    Boolean(aiMonthlyResult && aiMonthlyResult.length > 0) || Boolean(aiRationale);

  const handleSystemRecompute = () => {
    const ok = window.confirm(
      '将按当前系统算法重新计算本 SKU 预测，覆盖现有系统预测值（含此前 AI 写入值）。是否继续？',
    );
    if (ok) systemRecompute.mutate();
  };

  return (
    <section className="space-y-3 rounded-md border border-amber-200/80 bg-amber-50/50 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="space-y-1">
        <p className="text-sm font-medium text-text-main">预测辅助</p>
        <p className="text-xs text-text-sub">
          基于近 {DRAWER_HISTORY_MONTH_COUNT} 个月销量与品类趋势；AI 模式调用 Dify 工作流，系统运算走本地算法。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={profileSegment === 'T99' ? 'default' : 'outline'}
          disabled={!difyEnabled || aiPending || systemRecompute.isPending}
          onClick={() => aiAutoForecast.mutate()}
        >
          {aiAutoForecast.isPending ? 'AI 预测中…' : 'AI 自动辅助'}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={aiPending || systemRecompute.isPending}
          onClick={handleSystemRecompute}
        >
          {systemRecompute.isPending ? '系统运算中…' : '系统运算'}
        </Button>
      </div>

      {!difyEnabled && (
        <p className="text-xs text-text-sub">
          AI 模式未启用，请配置环境变量 DIFY_API_KEY_SALES_FORECAST 并导入销量预测工作流。
        </p>
      )}

      <div className="rounded border border-border/60 bg-card/50">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-text-main hover:text-primary"
          onClick={() => setHumanExpanded((v) => !v)}
        >
          <span>AI+人工辅助（外生因素：调价、投广告等）</span>
          <span className="shrink-0 text-text-sub">{humanExpanded ? '收起' : '展开'}</span>
        </button>

        {humanExpanded && (
          <div className="space-y-3 border-t border-border/60 px-3 pb-3 pt-2">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-text-sub">
                    <th className="p-1.5 font-normal">月份</th>
                    <th className="p-1.5 font-normal">类型</th>
                    <th className="p-1.5 font-normal">强度/幅度</th>
                    <th className="p-1.5 font-normal">说明</th>
                    <th className="p-1.5 font-normal w-12" />
                  </tr>
                </thead>
                <tbody>
                  {exogenousRows.map((row) => (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="p-1">
                        <select
                          className="h-8 w-full rounded border border-input bg-background px-1 text-xs"
                          value={row.monthLabel}
                          onChange={(e) =>
                            setExogenousRows((rows) =>
                              rows.map((r) =>
                                r.id === row.id ? { ...r, monthLabel: e.target.value } : r,
                              ),
                            )
                          }
                        >
                          {monthLabels.map((label) => (
                            <option key={label} value={label}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1">
                        <select
                          className="h-8 w-full rounded border border-input bg-background px-1 text-xs"
                          value={row.reason}
                          onChange={(e) =>
                            setExogenousRows((rows) =>
                              rows.map((r) =>
                                r.id === row.id
                                  ? { ...r, reason: e.target.value as ForecastExogenousReason }
                                  : r,
                              ),
                            )
                          }
                        >
                          {EXOGENOUS_REASON_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-8 text-xs"
                          placeholder="如 -10 或 1.5"
                          value={row.intensity}
                          onChange={(e) =>
                            setExogenousRows((rows) =>
                              rows.map((r) =>
                                r.id === row.id ? { ...r, intensity: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="p-1">
                        <Input
                          className="h-8 text-xs"
                          placeholder="可选"
                          value={row.note}
                          onChange={(e) =>
                            setExogenousRows((rows) =>
                              rows.map((r) =>
                                r.id === row.id ? { ...r, note: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td className="p-1 text-center">
                        <button
                          type="button"
                          className="text-text-sub hover:text-destructive"
                          onClick={() =>
                            setExogenousRows((rows) => rows.filter((r) => r.id !== row.id))
                          }
                        >
                          删
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={!defaultMonth}
              onClick={() => setExogenousRows((rows) => [...rows, newFactorRow(defaultMonth)])}
            >
              + 添加一行
            </Button>

            <div className="space-y-1">
              <label className="text-xs text-text-sub">运营补充说明</label>
              <textarea
                className="min-h-[60px] w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
                placeholder="如：Prime Day 加投、下月降价清仓…"
                value={operatorNote}
                onChange={(e) => setOperatorNote(e.target.value)}
              />
            </div>

            <Button
              size="sm"
              variant="secondary"
              disabled={humanSubmitDisabled}
              onClick={() => aiHumanForecast.mutate()}
            >
              {aiHumanForecast.isPending ? 'AI+人工预测中…' : 'AI+人工预测'}
            </Button>
          </div>
        )}
      </div>

      {aiMutation.isError && (
        <p className="text-xs text-destructive">
          {aiMutation.error instanceof Error ? aiMutation.error.message : 'AI 预测失败'}
        </p>
      )}
      {systemRecompute.isError && (
        <p className="text-xs text-destructive">
          {systemRecompute.error instanceof Error
            ? systemRecompute.error.message
            : '系统运算失败'}
        </p>
      )}
      {aiMutation.isSuccess && aiMutation.data && (
        <p className="text-xs text-text-sub">
          {lastAssistMode === 'human' ? 'AI+人工' : 'AI 自动'}已写入 {aiMutation.data.writtenRows}{' '}
          个月预测值
          {aiMutation.data.missingMonths?.length
            ? `；Dify 未返回：${aiMutation.data.missingMonths.join('、')}`
            : ''}
          。下方预测明细已刷新。
        </p>
      )}
      {systemRecompute.isSuccess && systemRecompute.data && !('async' in systemRecompute.data && systemRecompute.data.async) && (
        <p className="text-xs text-text-sub">
          系统运算完成，已写入 {systemRecompute.data.forecastRows.toLocaleString()} 行预测。下方明细已刷新。
        </p>
      )}

      {hasAiResult && (
        <div className="space-y-2">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-text-main hover:text-primary"
            onClick={() => setAiResultExpanded((v) => !v)}
          >
            <span>
              AI 分析结果（{aiMonthlyResult?.length ?? 0} 个月）
              {lastAssistMode === 'human' ? (
                <span className="ml-1 font-normal text-violet-700 dark:text-violet-300">
                  · 含人工外生
                </span>
              ) : null}
            </span>
            <span className="shrink-0 text-text-sub">{aiResultExpanded ? '收起' : '展开'}</span>
          </button>
          {aiResultExpanded && (
            <div className="space-y-2 rounded border border-border bg-card p-2">
              {aiMonthlyResult && aiMonthlyResult.length > 0 && (
                <table className="w-full table-fixed text-xs">
                  <colgroup>
                    <col className="w-14" />
                    <col className="w-16" />
                    <col className="w-14" />
                    <col />
                  </colgroup>
                  <thead>
                    <tr className="border-b border-border text-left text-text-sub">
                      <th className="p-1.5 font-normal">月份</th>
                      <th className="p-1.5 font-normal">预测日均</th>
                      <th className="p-1.5 font-normal">置信度</th>
                      <th className="p-1.5 font-normal">分析说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aiMonthlyResult.map((item) => (
                      <tr key={item.monthLabel} className="border-b border-border/60 align-top">
                        <td className="p-1.5 font-numeric whitespace-nowrap">{item.monthLabel}</td>
                        <td className="p-1.5 font-numeric text-primary">
                          {item.forecastDailyAvg > 0 ? formatFactor(item.forecastDailyAvg) : '—'}
                        </td>
                        <td className="p-1.5">{formatConfidenceLabel(item.confidence ?? null)}</td>
                        <td className="p-1.5 text-text-sub">{item.rationale || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {aiRationale && (
                <div className="space-y-1 border-t border-border/60 pt-2">
                  <p className="text-xs font-medium text-text-main">整体分析</p>
                  <p className="whitespace-pre-wrap text-xs text-text-sub">{aiRationale}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function aiAssistBadgeClass(assistMode?: string | null): string {
  if (assistMode === 'human') {
    return 'cursor-help rounded bg-violet-100 px-1 py-px text-[9px] font-normal leading-none text-violet-800 dark:bg-violet-900/40 dark:text-violet-300';
  }
  return 'cursor-help rounded bg-amber-100 px-1 py-px text-[9px] font-normal leading-none text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
}
