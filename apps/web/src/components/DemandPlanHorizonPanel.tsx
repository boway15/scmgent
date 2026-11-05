import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type DemandPlanDetailView, type DemandPlanMonthRow } from '@/lib/api';
import type { ProductScope } from '@/lib/product-scope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ListPagination } from '@/components/ListPagination';
import { mutationErrorMessage } from '@/lib/forecast-version-utils';
import { ForecastColumnHeader } from '@/components/ForecastColumnHeader';
import {
  demandPlanMergedCellTitle,
  demandPlanPeriodHeaderTitle,
  effectiveDemandPlanDaily,
  formatDemandPlanDaily,
  formatDemandPlanPeriodLabel,
} from '@/lib/demand-plan-utils';
import { formatForecastChannelLabel } from '@/lib/forecast-horizon-meta';
import { formatLifecycleLabel, formatTierDisplayLabel } from '@/lib/forecast-labels';
import { DEMAND_PLAN_CHAMPION_COLUMN_HELP } from '@/lib/demand-plan-column-help';
import { cn } from '@/lib/utils';
import type { DemandPlanSkuClickInput } from '@/components/DemandPlanSkuDetailDrawer';
import { DemandPlanCalibrationImportDialog } from '@/components/DemandPlanCalibrationImportDialog';

export type DemandPlanHorizonViewMode = 'wide' | 'long';

/** 宽表左侧固定列（SKU + 周维度属性），与横向滚动周列分离 */
const WIDE_STICKY_SKU =
  'sticky left-0 z-20 min-w-[10rem] max-w-[10rem] bg-card p-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]';
const WIDE_STICKY_PLATFORM =
  'sticky left-[10rem] z-20 min-w-[5rem] whitespace-nowrap bg-card p-2 shadow-[1px_0_3px_-1px_rgba(0,0,0,0.06)]';
const WIDE_STICKY_LIFECYCLE =
  'sticky left-[15rem] z-20 min-w-[4.5rem] whitespace-nowrap bg-card p-2';
const WIDE_STICKY_TIER =
  'sticky left-[19.5rem] z-20 min-w-[4rem] whitespace-nowrap bg-card p-2 shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]';

type Props = {
  active: boolean;
  versionId: string;
  skuCode?: string;
  grain: 'week' | 'month';
  editable?: boolean;
  pageSize?: number;
  channelView?: 'merged' | 'by_channel';
  platforms?: string[];
  profileSegment?: string;
  pendingCalibration?: boolean;
  categories?: string[];
  productScope?: ProductScope;
  calibrationImportEnabled?: boolean;
  initialCalibrationImportOpen?: boolean;
  onSkuClick?: (input: DemandPlanSkuClickInput) => void;
};

export function DemandPlanHorizonPanel({
  active,
  versionId,
  skuCode,
  grain,
  editable = false,
  pageSize: initialPageSize = 20,
  channelView = 'merged',
  platforms,
  profileSegment,
  pendingCalibration = false,
  categories,
  productScope,
  calibrationImportEnabled = false,
  initialCalibrationImportOpen = false,
  onSkuClick,
}: Props) {
  const mergedChannel = channelView !== 'by_channel';
  const queryClient = useQueryClient();
  const [viewMode, setViewMode] = useState<DemandPlanHorizonViewMode>('wide');
  const [exporting, setExporting] = useState<'wide' | 'detail' | 'calibration' | 'accuracy' | null>(
    null,
  );
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const [edits, setEdits] = useState<Record<string, { manual: string; reason: string }>>({});

  useEffect(() => {
    if (initialCalibrationImportOpen && calibrationImportEnabled) {
      setImportOpen(true);
    }
  }, [initialCalibrationImportOpen, calibrationImportEnabled]);

  const weekFilters =
    grain === 'week'
      ? {
          channelView,
          platforms: channelView === 'by_channel' && platforms?.length ? platforms : undefined,
          profileSegment: pendingCalibration ? undefined : profileSegment,
          pendingCalibration: pendingCalibration || undefined,
          categories: categories?.length ? categories : undefined,
          productScope,
        }
      : {};

  const detailQuery = useQuery({
    queryKey: [
      'demand-plan-data',
      versionId,
      viewMode,
      page,
      pageSize,
      skuCode ?? '',
      channelView,
      platforms?.join(',') ?? '',
      profileSegment ?? '',
      pendingCalibration,
      categories?.join('|') ?? '',
      productScope ?? 'goods',
    ],
    queryFn: () =>
      api.getDemandPlan(versionId, {
        view: viewMode as DemandPlanDetailView,
        page,
        pageSize,
        skuCode: skuCode || undefined,
        ...weekFilters,
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
  const canExportWeekly =
    grain === 'week' && Boolean(versionId) && paginationTotal > 0 && !detailQuery.isLoading;
  const importNeedsByChannel = calibrationImportEnabled && mergedChannel;

  const handleExport = async (mode: 'wide' | 'detail' | 'calibration' | 'accuracy') => {
    if (!versionId || grain !== 'week') return;
    if (mode === 'calibration' && mergedChannel) {
      window.alert('请先将「合计/分平台」切换为「分平台」，再导出校准表。');
      return;
    }
    if (
      mode === 'detail' &&
      calibrationImportEnabled &&
      importNeedsByChannel &&
      !window.confirm(
        '当前为「合计」视图，导出明细中全平台行可导入；分平台行需用「导出校准表」。\n\n仍要导出当前文件吗？',
      )
    ) {
      return;
    }
    setExporting(mode);
    try {
      if (mode === 'accuracy') {
        await api.exportDemandPlanAccuracy({
          versionId,
          skuCode: skuCode || undefined,
          ...weekFilters,
        });
      } else {
        await api.exportDemandPlanHorizon({
          versionId,
          mode,
          skuCode: skuCode || undefined,
          ...weekFilters,
        });
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '导出失败');
    } finally {
      setExporting(null);
    }
  };

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

  const renderSkuCell = (input: DemandPlanSkuClickInput & { skuName?: string | null }) => {
    const name = input.skuName?.trim() || null;
    if (onSkuClick) {
      return (
        <button
          type="button"
          className="text-left hover:text-primary"
          onClick={() =>
            onSkuClick({
              skuId: input.skuId,
              skuCode: input.skuCode,
              platform: input.platform?.trim() || 'ALL',
            })
          }
        >
          <div className="font-medium text-primary underline-offset-2 hover:underline">{input.skuCode}</div>
          {name ? (
            <div className="max-w-[140px] truncate text-xs text-text-sub" title={name}>
              {name}
            </div>
          ) : null}
        </button>
      );
    }
    return (
      <>
        <div className="font-medium font-mono">{input.skuCode}</div>
        {name ? (
          <div className="max-w-[140px] truncate text-xs text-text-sub" title={name}>
            {name}
          </div>
        ) : null}
      </>
    );
  };

  if (!active) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-md border border-border/80 bg-muted/25 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div
            className="inline-flex shrink-0 rounded-md border border-border bg-card p-0.5 shadow-sm"
            role="group"
            aria-label="表格视图"
          >
            <Button
              size="sm"
              className="h-7 px-3"
              variant={viewMode === 'wide' ? 'default' : 'ghost'}
              onClick={() => switchView('wide')}
            >
              宽表
            </Button>
            <Button
              size="sm"
              className="h-7 px-3"
              variant={viewMode === 'long' ? 'default' : 'ghost'}
              onClick={() => switchView('long')}
            >
              长表
            </Button>
          </div>
          {editable && viewMode === 'wide' ? (
            <p className="text-xs text-text-hint">人工调整请在「长表」中编辑并保存。</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 sm:shrink-0">
          {stats && stats.rowTotal > 0 ? (
            <p className="order-first w-full text-xs text-text-sub sm:order-none sm:w-auto sm:whitespace-nowrap sm:border-r sm:border-border sm:pr-3">
              共 {stats.skuTotal.toLocaleString()} SKU · {stats.rowTotal.toLocaleString()} 行
            </p>
          ) : null}
          {grain === 'week' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={!canExportWeekly || exporting != null}
                onClick={() => void handleExport('wide')}
              >
                {exporting === 'wide' ? '导出中…' : '导出宽表'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canExportWeekly || exporting != null}
                onClick={() => void handleExport('detail')}
              >
                {exporting === 'detail' ? '导出中…' : '导出明细'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!canExportWeekly || exporting != null}
                title="对比计划周与实销日均（有实销的周才填误差）"
                onClick={() => void handleExport('accuracy')}
              >
                {exporting === 'accuracy' ? '导出中…' : '导出准确度'}
              </Button>
              {calibrationImportEnabled ? (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canExportWeekly || exporting != null || importNeedsByChannel}
                    title={importNeedsByChannel ? '请先切换为「分平台」' : undefined}
                    onClick={() => void handleExport('calibration')}
                  >
                    {exporting === 'calibration' ? '导出中…' : '导出校准表'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
                    导入校准
                  </Button>
                </>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {calibrationImportEnabled && grain === 'week' ? (
        <DemandPlanCalibrationImportDialog
          open={importOpen}
          versionId={versionId}
          showChannelHint={importNeedsByChannel}
          onClose={() => setImportOpen(false)}
        />
      ) : null}

      {detailQuery.isLoading && !detailQuery.data ? (
        <p className="text-sm text-text-sub">加载中…</p>
      ) : detailQuery.isError ? (
        <p className="text-sm text-destructive">{mutationErrorMessage(detailQuery.error)}</p>
      ) : paginationTotal === 0 ? (
        <p className="text-sm text-text-sub">暂无计划数据。</p>
      ) : viewMode === 'wide' ? (
        <>
          <div className="overflow-auto rounded-md border border-border">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-text-sub">
                  <th
                    className={cn(
                      'font-normal',
                      grain === 'week' ? WIDE_STICKY_SKU : 'sticky left-0 z-10 bg-card p-2',
                    )}
                  >
                    SKU
                  </th>
                  {grain === 'week' ? (
                    <>
                      <th className={cn('font-normal', WIDE_STICKY_PLATFORM)}>平台</th>
                      <th className={cn('font-normal', WIDE_STICKY_LIFECYCLE)}>生命周期</th>
                      <th className={cn('font-normal', WIDE_STICKY_TIER)}>分层</th>
                    </>
                  ) : null}
                  {periods.map((period) => (
                    <th
                      key={period}
                      className="whitespace-nowrap p-2 font-mono font-normal"
                      title={demandPlanPeriodHeaderTitle(period, grain)}
                    >
                      {formatDemandPlanPeriodLabel(period, grain)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(widePage?.items ?? []).map((row) => (
                  <tr key={`${row.skuId}::${row.platform ?? 'ALL'}`} className="border-b border-border/60">
                    <td
                      className={cn(
                        grain === 'week' ? WIDE_STICKY_SKU : 'sticky left-0 z-10 bg-card p-2',
                      )}
                    >
                      {renderSkuCell({
                        skuId: row.skuId,
                        skuCode: row.skuCode,
                        skuName: row.skuName,
                        platform: row.platform ?? 'ALL',
                      })}
                    </td>
                    {grain === 'week' ? (
                      <>
                        <td className={cn('text-text-sub', WIDE_STICKY_PLATFORM)}>
                          {formatForecastChannelLabel(row.platform)}
                        </td>
                        <td className={cn('text-text-sub', WIDE_STICKY_LIFECYCLE)}>
                          {formatLifecycleLabel(row.lifecycle)}
                        </td>
                        <td
                          className={cn('text-xs text-text-sub', WIDE_STICKY_TIER)}
                          title={row.profileSegment ?? undefined}
                        >
                          {row.profileSegment
                            ? formatTierDisplayLabel(row.profileSegment)
                            : '—'}
                        </td>
                      </>
                    ) : null}
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
                          title={demandPlanMergedCellTitle({
                            cell,
                            profileSegment: row.profileSegment,
                            mergedChannel,
                          })}
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
                  {grain === 'week' ? (
                    <>
                      <th className="p-2 font-normal">平台</th>
                      <th className="p-2 font-normal">生命周期</th>
                      <th className="p-2 font-normal">分层</th>
                    </>
                  ) : null}
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
                          ? renderSkuCell({
                              skuId: row.skuId,
                              skuCode: row.skuCode,
                              skuName: row.skuName,
                              platform: row.platform ?? 'ALL',
                            })
                          : (row.skuCode ?? '—')}
                      </td>
                      {grain === 'week' ? (
                        <>
                          <td className="p-2 text-text-sub">
                            {formatForecastChannelLabel(row.platform ?? 'ALL')}
                          </td>
                          <td className="p-2 text-text-sub">{formatLifecycleLabel(row.lifecycle)}</td>
                          <td className="p-2 text-xs text-text-sub whitespace-nowrap" title={row.profileSegment ?? undefined}>
                            {row.profileSegment
                              ? formatTierDisplayLabel(row.profileSegment)
                              : '—'}
                          </td>
                        </>
                      ) : null}
                      <td
                        className="p-2 font-mono"
                        title={demandPlanPeriodHeaderTitle(row.period, grain)}
                      >
                        {formatDemandPlanPeriodLabel(row.period, grain)}
                      </td>
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
