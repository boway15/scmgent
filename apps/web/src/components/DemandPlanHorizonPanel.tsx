import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DemandPlanDetailView, type DemandPlanMonthRow } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListPagination } from '@/components/ListPagination';
import { mutationErrorMessage } from '@/lib/forecast-version-utils';
import { ForecastColumnHeader } from '@/components/ForecastColumnHeader';
import {
  demandPlanCellTitle,
  effectiveDemandPlanDaily,
  formatDemandPlanDaily,
} from '@/lib/demand-plan-utils';
import { DEMAND_PLAN_CHAMPION_COLUMN_HELP } from '@/lib/demand-plan-column-help';
import { cn } from '@/lib/utils';
import type { DemandPlanSkuClickInput } from '@/components/DemandPlanSkuDetailDrawer';

export type DemandPlanHorizonViewMode = 'wide' | 'long';

type Props = {
  active: boolean;
  versionId: string;
  skuCode?: string;
  grain: 'week' | 'month';
  editable?: boolean;
  pageSize?: number;
  onSkuClick?: (input: DemandPlanSkuClickInput) => void;
};

export function DemandPlanHorizonPanel({
  active,
  versionId,
  skuCode,
  grain,
  editable = false,
  pageSize: initialPageSize = 20,
  onSkuClick,
}: Props) {
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<DemandPlanHorizonViewMode>('wide');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [edits, setEdits] = useState<Record<string, { manual: string; reason: string }>>({});

  const detailQuery = useQuery({
    queryKey: ['demand-plan-data', versionId, viewMode, page, pageSize, skuCode ?? ''],
    queryFn: () =>
      api.getDemandPlan(versionId, {
        view: viewMode as DemandPlanDetailView,
        page,
        pageSize,
        skuCode: skuCode || undefined,
      }),
    enabled: active && Boolean(versionId),
    placeholderData: (previous) => previous,
  });

  const periods = detailQuery.data?.periods ?? [];
  const stats = detailQuery.data?.stats;
  const longPage = detailQuery.data?.long;
  const widePage = detailQuery.data?.wide;
  const periodLabel = grain === 'week' ? '周' : '月';
  const paginationTotal = viewMode === 'wide' ? (widePage?.total ?? 0) : (longPage?.total ?? 0);

  const savePeriod = useMutation({
    mutationFn: (input: {
      periodId: string;
      manualDailyAvg: number | null;
      adjustReason: string;
    }) =>
      grain === 'week'
        ? api.updateDemandPlanWeek(versionId, input.periodId, {
            manualDailyAvg: input.manualDailyAvg,
            adjustReason: input.adjustReason,
          })
        : api.updateDemandPlanMonth(versionId, input.periodId, {
            manualDailyAvg: input.manualDailyAvg,
            adjustReason: input.adjustReason,
          }),
    onSuccess: async (_data, variables) => {
      setEdits((current) => {
        const next = { ...current };
        delete next[variables.periodId];
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ['demand-plan-data', versionId] });
      await queryClient.invalidateQueries({ queryKey: ['demand-plan-version', versionId] });
    },
  });

  const saveRow = (row: DemandPlanMonthRow) => {
    const draft = edits[row.id];
    const raw = (draft?.manual ?? row.manualDailyAvg ?? '').trim();
    const reason = (draft?.reason ?? row.adjustReason ?? '').trim();
    const manualDailyAvg = raw === '' ? null : Number(raw);
    if (manualDailyAvg != null && !Number.isFinite(manualDailyAvg)) return;
    savePeriod.mutate({ periodId: row.id, manualDailyAvg, adjustReason: reason });
  };

  const switchView = (next: DemandPlanHorizonViewMode) => {
    setViewMode(next);
    setPage(1);
    setPageSize(next === 'wide' ? 20 : 50);
  };

  const renderSkuCell = (input: DemandPlanSkuClickInput) => {
    if (onSkuClick) {
      return (
        <button
          type="button"
          className="text-left hover:text-primary"
          onClick={() => onSkuClick(input)}
        >
          <div className="font-medium text-primary underline-offset-2 hover:underline">{input.skuCode}</div>
        </button>
      );
    }
    return <span className="font-mono">{input.skuCode}</span>;
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={viewMode === 'wide' ? 'default' : 'outline'}
            onClick={() => switchView('wide')}
          >
            宽表
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'long' ? 'default' : 'outline'}
            onClick={() => switchView('long')}
          >
            长表
          </Button>
        </div>
        {stats && stats.rowTotal > 0 ? (
          <p className="ml-auto text-xs text-text-sub">
            共 {stats.skuTotal.toLocaleString()} SKU · {stats.rowTotal.toLocaleString()} 行
          </p>
        ) : null}
      </div>

      {editable && viewMode === 'wide' ? (
        <p className="text-xs text-text-hint">人工调整请在「长表」中编辑并保存。</p>
      ) : null}

      {detailQuery.isLoading && !detailQuery.data ? (
        <p className="text-sm text-text-sub">加载中…</p>
      ) : detailQuery.isError ? (
        <p className="text-sm text-destructive">{mutationErrorMessage(detailQuery.error)}</p>
      ) : paginationTotal === 0 ? (
        <p className="text-sm text-text-sub">暂无计划数据。</p>
      ) : viewMode === 'wide' ? (
        <>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="sticky left-0 z-10 bg-card p-2 font-normal">SKU</th>
                  {periods.map((period) => (
                    <th key={period} className="whitespace-nowrap p-2 font-mono font-normal">
                      {period}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(widePage?.items ?? []).map((row) => (
                  <tr key={row.skuId} className="border-b border-border/60">
                    <td className="sticky left-0 z-10 bg-card p-2">
                      {renderSkuCell({ skuId: row.skuId, skuCode: row.skuCode })}
                    </td>
                    {periods.map((period) => {
                      const cell = row.cells[period];
                      if (!cell) {
                        return (
                          <td key={period} className="p-2 text-center text-text-sub">
                            —
                          </td>
                        );
                      }
                      const effective = effectiveDemandPlanDaily(cell);
                      const calibrated = cell.manualDailyAvg != null;
                      return (
                        <td
                          key={period}
                          className={cn(
                            'p-2 text-center font-numeric',
                            Number(effective) > 0
                              ? calibrated
                                ? 'text-amber-700 dark:text-amber-300'
                                : 'text-primary'
                              : 'text-text-sub',
                          )}
                          title={demandPlanCellTitle(cell)}
                        >
                          {formatDemandPlanDaily(effective)}
                          {calibrated ? (
                            <div className="text-[10px] font-normal text-text-sub">人工</div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={paginationTotal}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
          />
        </>
      ) : (
        <>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th className="p-2 font-normal">SKU</th>
                  <th className="p-2 font-normal">{periodLabel}</th>
                  <th className="p-2 font-normal">系统日均</th>
                  <th className="p-2 font-normal">人工日均</th>
                  <ForecastColumnHeader label="Champion" help={DEMAND_PLAN_CHAMPION_COLUMN_HELP} />
                  <th className="p-2 font-normal">来源</th>
                  {editable ? <th className="p-2 font-normal">调整原因</th> : null}
                  {editable ? <th className="p-2 font-normal">操作</th> : null}
                </tr>
              </thead>
              <tbody>
                {(longPage?.items ?? []).map((row) => {
                  const draft = edits[row.id];
                  return (
                    <tr key={row.id} className="border-b border-border/60">
                      <td className="p-2">
                        {row.skuId && row.skuCode
                          ? renderSkuCell({ skuId: row.skuId, skuCode: row.skuCode })
                          : (row.skuCode ?? '—')}
                      </td>
                      <td className="p-2 font-mono">{row.period}</td>
                      <td className="p-2 font-numeric">{formatDemandPlanDaily(row.systemDailyAvg)}</td>
                      <td className="p-2">
                        {editable ? (
                          <Input
                            className="h-8 w-28 font-numeric"
                            value={draft?.manual ?? row.manualDailyAvg ?? ''}
                            placeholder="空=系统值"
                            onChange={(event) =>
                              setEdits((current) => ({
                                ...current,
                                [row.id]: {
                                  manual: event.target.value,
                                  reason: current[row.id]?.reason ?? row.adjustReason ?? '',
                                },
                              }))
                            }
                          />
                        ) : (
                          <span className="font-numeric">{formatDemandPlanDaily(row.manualDailyAvg)}</span>
                        )}
                      </td>
                      <td className="p-2 font-numeric">
                        {formatDemandPlanDaily(row.championForecastDaily)}
                      </td>
                      <td className="p-2 text-text-sub">{row.source}</td>
                      {editable ? (
                        <td className="p-2">
                          <Input
                            className="h-8 w-40"
                            value={draft?.reason ?? row.adjustReason ?? ''}
                            placeholder="改人工须填原因"
                            onChange={(event) =>
                              setEdits((current) => ({
                                ...current,
                                [row.id]: {
                                  manual: current[row.id]?.manual ?? row.manualDailyAvg ?? '',
                                  reason: event.target.value,
                                },
                              }))
                            }
                          />
                        </td>
                      ) : null}
                      {editable ? (
                        <td className="p-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={savePeriod.isPending}
                            onClick={() => saveRow(row)}
                          >
                            保存
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ListPagination
            page={page}
            pageSize={pageSize}
            total={paginationTotal}
            onPageChange={setPage}
            onPageSizeChange={(next) => {
              setPageSize(next);
              setPage(1);
            }}
          />
        </>
      )}
      {savePeriod.isError && (
        <p className="text-sm text-destructive">{mutationErrorMessage(savePeriod.error)}</p>
      )}
    </div>
  );
}
