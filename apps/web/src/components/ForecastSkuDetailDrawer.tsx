import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  formatConfidenceLabel,
  formatLifecycleLabel,
  formatTierDisplayLabel,
  formatT99ReviewMessage,
} from '@/lib/forecast-labels';
import {
  DRAWER_HISTORY_MONTH_COUNT,
  MAX_FORECAST_MONTH_COUNT,
  buildForwardMonthLabels,
  resolveHorizonPlatformScope,
} from '@/lib/forecast-horizon-meta';
import {
  isAllCatV41ForecastCell,
  isT99ForecastTier,
  type AllCatV41HorizonDisplay,
} from '@/lib/forecast-horizon-display';
import { cn } from '@/lib/utils';
import { ForecastColumnHeader } from '@/components/ForecastColumnHeader';
import {
  getForecastHorizonColumnHelp,
  type ForecastHorizonColumnHelpContext,
} from '@/lib/forecast-horizon-column-help';
import { buildV41SystemCellTitle } from '@/lib/forecast-v41-system-formula';
import {
  hasAnyLegacyHorizonColumn,
  isAiAssistForecastDetail,
  resolveAiAssistModeFromMonths,
  resolveLegacyHorizonColumnVisibility,
  resolveV41AnchoredSnapshot,
  resolveV41DetailColumnVisibility,
} from '@/lib/forecast-detail-columns';
import { ForecastAssistPanel, aiAssistBadgeClass } from '@/components/ForecastAssistPanel';

export type { AllCatV41HorizonDisplay };

export type ForecastHorizonMonthCell = {
  id?: string;
  forecastYear: number;
  month: number;
  monthLabel: string;
  forecastDailyAvg: number;
  manualDailyAvg?: number | null;
  effectiveDailyAvg?: number;
  adjustReason?: string | null;
  baselineDailyAvg: number | null;
  lifecycle: string | null;
  confidenceLevel: string | null;
  skuTrendFactor: number | null;
  seasonalityFactor: number;
  trendFactor: number;
  categoryCombinedFactor: number;
  categoryTrendWasClipped: boolean;
  categoryTrendMatched: boolean;
  horizonFactors: {
    nearLevel: number;
    structuralLevel: number;
    yoyMonthLevel: number;
    yoyAnchorLevel: number;
    growthFactor: number;
    wNear: number;
    wYoy: number;
    horizonMonthIndex: number;
  } | null;
  allCatV41Factors?: AllCatV41HorizonDisplay | null;
  forecastModel?: string | null;
  aiAssistRationale?: string | null;
  aiAssistMode?: 'auto' | 'human' | null;
};

export type ForecastHorizonRow = {
  skuId: string;
  skuCode: string;
  skuName: string;
  category: string | null;
  station: string;
  platform: string;
  lifecycle: string | null;
  forecastProfileClass?: string | null;
  profileSegment?: string | null;
  historyMonths: Array<{
    forecastYear: number;
    month: number;
    monthLabel: string;
    qtySold: number;
    actualDailyAvg: number;
  }>;
  months: ForecastHorizonMonthCell[];
};

type Props = {
  versionId: string;
  row: ForecastHorizonRow | null;
  onClose: () => void;
  /** 与列表矩阵一致的渠道口径（ALL=全渠道汇总） */
  horizonPlatform?: string;
  /** 草稿复核页允许编辑校准值 */
  calibrationEditable?: boolean;
  /** 生成预测时选择的月数；用于 AI 辅助预测与明细展示，避免仅按库内已有月份推断 */
  forecastMonthCount?: number;
};

const DEFAULT_MONTH_COUNT = MAX_FORECAST_MONTH_COUNT;

const formatFactor = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value.toFixed(2);

const formatPct = (value: number) => `${Math.round(value * 100)}%`;

const formatNumber = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value.toFixed(2);

function effectiveDaily(cell: ForecastHorizonMonthCell): number {
  if (cell.effectiveDailyAvg != null && Number.isFinite(cell.effectiveDailyAvg)) {
    return cell.effectiveDailyAvg;
  }
  if (cell.manualDailyAvg != null && Number.isFinite(cell.manualDailyAvg)) {
    return cell.manualDailyAvg;
  }
  return cell.forecastDailyAvg;
}

function CalibrationCells({
  cell,
  editable,
  onSaved,
  systemCellTitle,
}: {
  cell: ForecastHorizonMonthCell;
  editable: boolean;
  onSaved: () => void;
  /** V4.1 等：悬停「系统」列展示计算拆解 */
  systemCellTitle?: string;
}) {
  const [manualInput, setManualInput] = useState(
    cell.manualDailyAvg != null ? String(cell.manualDailyAvg) : '',
  );
  const [reasonInput, setReasonInput] = useState(cell.adjustReason ?? '');
  const [reasonOpen, setReasonOpen] = useState(Boolean(cell.adjustReason));

  useEffect(() => {
    setManualInput(cell.manualDailyAvg != null ? String(cell.manualDailyAvg) : '');
    setReasonInput(cell.adjustReason ?? '');
    setReasonOpen(Boolean(cell.adjustReason));
  }, [cell.id, cell.manualDailyAvg, cell.adjustReason]);

  const saveCalibration = useMutation({
    mutationFn: async () => {
      if (!cell.id) throw new Error('缺少预测行 ID');
      const trimmed = manualInput.trim();
      if (!trimmed) {
        return api.updateSalesForecast(cell.id, {
          clearManual: true,
          adjustReason: reasonInput.trim() || null,
        });
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error('校准值须为 ≥0 的数字');
      }
      return api.updateSalesForecast(cell.id, {
        manualDailyAvg: parsed,
        adjustReason: reasonInput.trim() || undefined,
      });
    },
    onSuccess: () => onSaved(),
  });

  const savedManual = cell.manualDailyAvg != null ? String(cell.manualDailyAvg) : '';
  const savedReason = cell.adjustReason ?? '';
  const hasCalibration = cell.manualDailyAvg != null;
  const effective = effectiveDaily(cell);

  const previewEffective = (() => {
    const trimmed = manualInput.trim();
    if (!trimmed) return cell.forecastDailyAvg;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : effective;
  })();

  const isDirty = manualInput !== savedManual || reasonInput !== savedReason;

  const persistIfDirty = () => {
    if (!isDirty || saveCalibration.isPending) return;
    saveCalibration.mutate();
  };

  const clearCalibration = async () => {
    if (!cell.id || saveCalibration.isPending) return;
    await api.updateSalesForecast(cell.id, {
      clearManual: true,
      adjustReason: reasonInput.trim() || null,
    });
    setManualInput('');
    onSaved();
  };

  const systemCell = (
    <td
      className={cn(
        'p-2 font-numeric text-text-sub whitespace-nowrap',
        systemCellTitle && 'cursor-help underline decoration-dotted decoration-text-sub/40 underline-offset-2',
      )}
      title={systemCellTitle}
    >
      {formatFactor(cell.forecastDailyAvg)}
    </td>
  );

  if (!editable || !cell.id) {
    return (
      <>
        {systemCell}
        <td className="p-2 font-numeric text-text-sub whitespace-nowrap">
          {hasCalibration ? formatFactor(cell.manualDailyAvg) : '—'}
        </td>
        <td className="p-2 font-numeric whitespace-nowrap">
          <span className={cn(hasCalibration && 'font-medium text-amber-700 dark:text-amber-300')}>
            {formatFactor(effective)}
          </span>
          {cell.adjustReason ? (
            <div className="mt-0.5 max-w-[8rem] text-[10px] text-text-sub line-clamp-1" title={cell.adjustReason}>
              {cell.adjustReason}
            </div>
          ) : null}
        </td>
      </>
    );
  }

  return (
    <>
      {systemCell}
      <td className="p-2 align-middle">
        <div className="flex items-center gap-1.5">
          <Input
            type="text"
            inputMode="decimal"
            className="h-7 w-[4.5rem] px-2 font-numeric text-sm"
            placeholder="—"
            title="留空则使用系统预测；失焦或回车保存"
            value={manualInput}
            disabled={saveCalibration.isPending}
            onChange={(e) => setManualInput(e.target.value)}
            onBlur={persistIfDirty}
            onKeyDown={(e) => {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                return;
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                persistIfDirty();
              }
              if (e.key === 'Escape') {
                setManualInput(savedManual);
                setReasonInput(savedReason);
                setReasonOpen(Boolean(savedReason));
              }
            }}
          />
          {hasCalibration ? (
            <button
              type="button"
              className="shrink-0 text-[10px] text-text-sub hover:text-destructive disabled:opacity-50"
              disabled={saveCalibration.isPending}
              onClick={() => void clearCalibration()}
            >
              重置
            </button>
          ) : null}
        </div>
        {reasonOpen ? (
          <Input
            className="mt-1 h-6 max-w-[8rem] px-2 text-[10px]"
            placeholder="备注（可选）"
            value={reasonInput}
            disabled={saveCalibration.isPending}
            onChange={(e) => setReasonInput(e.target.value)}
            onBlur={persistIfDirty}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                persistIfDirty();
              }
            }}
          />
        ) : (
          <button
            type="button"
            className="mt-0.5 text-[10px] text-text-sub hover:text-primary"
            onClick={() => setReasonOpen(true)}
          >
            + 备注
          </button>
        )}
        {saveCalibration.isError ? (
          <p className="mt-0.5 text-[10px] text-destructive">
            {saveCalibration.error instanceof Error ? saveCalibration.error.message : '保存失败'}
          </p>
        ) : null}
      </td>
      <td className="p-2 align-middle font-numeric whitespace-nowrap">
        <span
          className={cn(
            'font-medium',
            hasCalibration || manualInput.trim()
              ? 'text-amber-700 dark:text-amber-300'
              : 'text-primary',
          )}
        >
          {formatFactor(isDirty ? previewEffective : effective)}
        </span>
        {saveCalibration.isPending ? (
          <span className="ml-1 text-[10px] text-text-sub">保存中</span>
        ) : null}
      </td>
    </>
  );
}

export function ForecastSkuDetailDrawer({
  versionId,
  row,
  onClose,
  horizonPlatform,
  calibrationEditable = false,
  forecastMonthCount,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [historyExpanded, setHistoryExpanded] = useState(false);

  const invalidateForecast = () => {
    qc.invalidateQueries({ queryKey: ['sales-forecast-horizon'] });
    qc.invalidateQueries({ queryKey: ['sales-forecast-horizon-row'] });
    qc.invalidateQueries({ queryKey: ['sales-forecasts'] });
  };

  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: [
      'sales-forecast-sku-detail',
      versionId,
      row?.skuId,
      row?.skuCode,
      row?.station,
      row?.platform,
    ],
    queryFn: () =>
      api.getSalesForecastSkuDetail({
        versionId,
        skuId: row!.skuId || undefined,
        skuCode: row!.skuId ? undefined : row!.skuCode,
        station: row!.station,
        platform: row!.platform,
      }),
    enabled: Boolean(versionId && row && (row.skuId || row.skuCode)),
  });

  const resolvedSkuId = detail?.sku?.id ?? row?.skuId ?? '';
  const skuMaster = detail?.sku;
  const platformScope = resolveHorizonPlatformScope(
    horizonPlatform ?? row?.platform,
  );

  const horizonMonthCount = Math.min(
    MAX_FORECAST_MONTH_COUNT,
    forecastMonthCount ??
      detail?.versionSummary?.monthCount ??
      row?.months.length ??
      DEFAULT_MONTH_COUNT,
  );

  const { data: horizonRowData, isLoading: horizonLoading } = useQuery({
    queryKey: [
      'sales-forecast-horizon-row',
      versionId,
      resolvedSkuId,
      row?.skuCode,
      row?.station,
      platformScope,
      horizonMonthCount,
      DRAWER_HISTORY_MONTH_COUNT,
    ],
    queryFn: () =>
      api.getSalesForecastHorizon({
        versionId,
        skuId: resolvedSkuId || row?.skuId || undefined,
        skuCode: resolvedSkuId || row?.skuId ? undefined : row!.skuCode,
        station: row!.station,
        platform: platformScope,
        page: 1,
        pageSize: 1,
        monthCount: horizonMonthCount,
        historyMonthCount: DRAWER_HISTORY_MONTH_COUNT,
      }),
    enabled: Boolean(versionId && row && (resolvedSkuId || row.skuCode)),
  });

  const displayRow = horizonRowData?.items[0]
    ? {
        ...horizonRowData.items[0],
        skuId: horizonRowData.items[0].skuId || resolvedSkuId,
        skuName: horizonRowData.items[0].skuName || skuMaster?.name || row?.skuName || row?.skuCode,
        category: horizonRowData.items[0].category ?? skuMaster?.category ?? row?.category ?? null,
        platform: platformScope,
      }
    : row
      ? {
          ...row,
          skuId: resolvedSkuId || row.skuId,
          skuName: skuMaster?.name || row.skuName || row.skuCode,
          category: skuMaster?.category ?? row.category,
        }
      : null;
  const isLoading = detailLoading || horizonLoading;
  const versionIsDraft = horizonRowData?.version?.status === 'draft';
  const canEditCalibration = calibrationEditable && versionIsDraft;
  const profileSegment =
    displayRow?.profileSegment ?? detail?.context?.profileSegment ?? null;
  const monthCells = (displayRow?.months ?? []) as ForecastHorizonMonthCell[];
  const aiAssistMode = resolveAiAssistModeFromMonths(monthCells);
  const profileSegmentLabel = formatTierDisplayLabel(profileSegment, aiAssistMode);
  const canRunAiForecast = Boolean(canEditCalibration && displayRow);
  const useV41DetailColumns = Boolean(
    displayRow?.months.some((cell) => isAllCatV41ForecastCell(cell)),
  );
  const v41AnchorFormula = useV41DetailColumns
    ? (displayRow?.months as ForecastHorizonMonthCell[] | undefined)?.[0]?.allCatV41Factors
        ?.formula
    : undefined;
  const columnHelpCtx: ForecastHorizonColumnHelpContext = {
    mode: useV41DetailColumns ? 'v41' : 'legacy',
    anchorFormula: v41AnchorFormula,
    tier: profileSegment,
    t99Diagnostic: isT99ForecastTier(profileSegment),
  };
  const v41AnchoredSnapshot = useV41DetailColumns
    ? resolveV41AnchoredSnapshot(monthCells)
    : null;
  const v41ColumnVisibility = useV41DetailColumns
    ? resolveV41DetailColumnVisibility(monthCells)
    : null;
  const isAiAssistDetail = isAiAssistForecastDetail(monthCells);
  const legacyHorizonColumns = !useV41DetailColumns
    ? resolveLegacyHorizonColumnVisibility(monthCells)
    : null;
  const showLegacyHorizonColumns = Boolean(
    legacyHorizonColumns && hasAnyLegacyHorizonColumn(legacyHorizonColumns),
  );

  const assistMonthLabels =
    displayRow?.months.map((m) => m.monthLabel).filter(Boolean).length
      ? displayRow!.months.map((m) => m.monthLabel)
      : buildForwardMonthLabels(horizonMonthCount);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (row) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [row]);

  useEffect(() => {
    setHistoryExpanded(false);
  }, [row?.skuCode, row?.station, row?.platform]);

  const ctx = detail?.context;
  const reviewItems = detail?.reviewItems ?? [];
  const specAttrsEntries =
    skuMaster?.specAttrs && typeof skuMaster.specAttrs === 'object'
      ? Object.entries(skuMaster.specAttrs)
      : [];

  return (
    <dialog
      ref={dialogRef}
      className="m-0 ml-auto h-full max-h-full w-full max-w-4xl border-l border-border bg-card p-0 shadow-card backdrop:bg-black/30"
      onClose={onClose}
    >
      {displayRow && (
        <div className="flex h-full flex-col">
          <div className="shrink-0 flex items-start justify-between gap-3 border-b border-border p-4">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm text-text-sub">{displayRow.skuCode}</p>
              <h2 className="whitespace-normal break-words text-lg font-semibold leading-snug text-text-main">
                {displayRow.skuName || '—'}
              </h2>
              <p className="mt-1 text-sm text-text-sub">
                {displayRow.platform}
                {displayRow.category ? ` · ${displayRow.category}` : ''}
                {' · '}
                {formatLifecycleLabel(displayRow.lifecycle)}
                {profileSegment ? (
                  <>
                    {' · '}
                    <span className="text-primary" title={profileSegment}>
                      分层 {profileSegmentLabel}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={onClose}>
              关闭
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-10 space-y-6">
            {canRunAiForecast && displayRow && (
              <ForecastAssistPanel
                skuCode={displayRow.skuCode}
                station={displayRow.station}
                platform={displayRow.platform}
                versionId={versionId}
                horizonMonthCount={horizonMonthCount}
                monthLabels={assistMonthLabels}
                profileSegment={profileSegment}
              />
            )}

            {isLoading ? (
              <p className="text-text-sub">加载中…</p>
            ) : (
              <>
                {skuMaster && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium text-text-main">商品信息</h3>
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
                      <p>
                        品类：<span className="text-text-main">{skuMaster.category || '—'}</span>
                        {skuMaster.productCategory ? (
                          <>
                            {' · '}
                            产品分类：<span className="text-text-main">{skuMaster.productCategory}</span>
                          </>
                        ) : null}
                      </p>
                      <p className="text-text-sub">
                        单位 {skuMaster.unit || '—'}
                        {skuMaster.salesCountry ? ` · 销售国家 ${skuMaster.salesCountry}` : ''}
                        {skuMaster.lifecycle ? ` · 生命周期 ${skuMaster.lifecycle}` : ''}
                        {skuMaster.leadTimeDays != null ? ` · 交期 ${skuMaster.leadTimeDays} 天` : ''}
                        {skuMaster.moq != null ? ` · MOQ ${skuMaster.moq}` : ''}
                      </p>
                      {(skuMaster.ownerName || skuMaster.developerName) && (
                        <p className="text-text-sub">
                          {skuMaster.ownerName ? `负责人 ${skuMaster.ownerName}` : ''}
                          {skuMaster.ownerName && skuMaster.developerName ? ' · ' : ''}
                          {skuMaster.developerName ? `开发 ${skuMaster.developerName}` : ''}
                        </p>
                      )}
                      {(skuMaster.merchantCode || skuMaster.merchantName) && (
                        <p className="text-text-sub">
                          商家 {skuMaster.merchantName || skuMaster.merchantCode}
                          {skuMaster.merchantCode && skuMaster.merchantName
                            ? `（${skuMaster.merchantCode}）`
                            : ''}
                        </p>
                      )}
                      {specAttrsEntries.length > 0 && (
                        <p className="text-text-sub">
                          规格：
                          {specAttrsEntries.map(([key, value]) => `${key}=${value}`).join(' · ')}
                        </p>
                      )}
                    </div>
                  </section>
                )}

                {reviewItems.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium text-text-main">复核提示</h3>
                    <ul className="space-y-2 text-xs text-text-sub">
                      {reviewItems.map((item) => (
                        <li
                          key={item.id}
                          className="rounded-md border border-border/60 bg-muted/20 p-2"
                        >
                          <span className="font-medium text-text-main">{item.severity}</span>
                          {' · '}
                          {formatT99ReviewMessage(item.message)}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-text-main">
                    未来 {displayRow.months.length} 月预测明细
                  </h3>
                  <p className="text-xs text-text-sub">
                    系统预测由 V4.1 分层 KPI 或 AI 辅助生成；校准列留空则沿用系统值，失焦或回车保存。
                    {useV41DetailColumns
                      ? v41AnchoredSnapshot
                        ? ' 走步特征 d6/趋势比/锚定见下方基线因子；表中仅展示按月变化的季节朴素与混合水平。'
                        : ' V4.1 模式下展示走步特征；商品分层见标题。'
                      : isAiAssistDetail
                        ? ' AI 辅助预测无 legacy 近端/同比混合因子，表中仅展示品类季节趋势与预测结果。'
                        : ' legacy 模式展示近端/同比混合权重与品类季节趋势系数。'}
                    {isT99ForecastTier(profileSegment)
                      ? ' T99 层系统预测为 0.00，锚定/季节/混合水平仅供诊断，与列表矩阵一致。'
                      : null}
                    {canEditCalibration ? ' 当前为草稿，可编辑校准。' : ' 已发布版本只读。'}
                  </p>
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-text-sub">
                          <ForecastColumnHeader
                            className="w-0 whitespace-nowrap"
                            label="月份"
                            help={getForecastHorizonColumnHelp('month', columnHelpCtx)}
                          />
                          <ForecastColumnHeader
                            label="置信度"
                            help={getForecastHorizonColumnHelp('confidence', columnHelpCtx)}
                          />
                          <ForecastColumnHeader
                            label="基线"
                            help={getForecastHorizonColumnHelp('baseline', columnHelpCtx)}
                          />
                          {useV41DetailColumns ? (
                            <>
                              {v41ColumnVisibility?.d6 ? (
                                <ForecastColumnHeader
                                  label="d6"
                                  help={getForecastHorizonColumnHelp('d6', columnHelpCtx)}
                                />
                              ) : null}
                              {v41ColumnVisibility?.trendRatio ? (
                                <ForecastColumnHeader
                                  label="趋势比"
                                  help={getForecastHorizonColumnHelp('trendRatio', columnHelpCtx)}
                                />
                              ) : null}
                              {v41ColumnVisibility?.anchor ? (
                                <ForecastColumnHeader
                                  label="锚定"
                                  help={getForecastHorizonColumnHelp('anchor', columnHelpCtx)}
                                />
                              ) : null}
                              {v41ColumnVisibility?.seasonal ? (
                                <ForecastColumnHeader
                                  label="季节朴素"
                                  help={getForecastHorizonColumnHelp('seasonal', columnHelpCtx)}
                                />
                              ) : null}
                              {v41ColumnVisibility?.blendLevel ? (
                                <ForecastColumnHeader
                                  label="混合水平"
                                  help={getForecastHorizonColumnHelp('blendLevel', columnHelpCtx)}
                                />
                              ) : null}
                            </>
                          ) : (
                            <>
                              {showLegacyHorizonColumns && legacyHorizonColumns?.wNear ? (
                                <ForecastColumnHeader
                                  label="w近"
                                  help={getForecastHorizonColumnHelp('wNear', columnHelpCtx)}
                                />
                              ) : null}
                              {showLegacyHorizonColumns && legacyHorizonColumns?.wYoy ? (
                                <ForecastColumnHeader
                                  label="w同比"
                                  help={getForecastHorizonColumnHelp('wYoy', columnHelpCtx)}
                                />
                              ) : null}
                              {showLegacyHorizonColumns && legacyHorizonColumns?.nearLevel ? (
                                <ForecastColumnHeader
                                  label="近端"
                                  help={getForecastHorizonColumnHelp('nearLevel', columnHelpCtx)}
                                />
                              ) : null}
                              {showLegacyHorizonColumns && legacyHorizonColumns?.structuralLevel ? (
                                <ForecastColumnHeader
                                  label="结构"
                                  help={getForecastHorizonColumnHelp('structuralLevel', columnHelpCtx)}
                                />
                              ) : null}
                              {showLegacyHorizonColumns && legacyHorizonColumns?.growthFactor ? (
                                <ForecastColumnHeader
                                  label="增长"
                                  help={getForecastHorizonColumnHelp('growthFactor', columnHelpCtx)}
                                />
                              ) : null}
                              {showLegacyHorizonColumns && legacyHorizonColumns?.yoyMonthLevel ? (
                                <ForecastColumnHeader
                                  label="YoY月"
                                  help={getForecastHorizonColumnHelp('yoyMonthLevel', columnHelpCtx)}
                                />
                              ) : null}
                              <ForecastColumnHeader
                                label="季节"
                                help={getForecastHorizonColumnHelp('seasonality', columnHelpCtx)}
                              />
                              <ForecastColumnHeader
                                label="趋势"
                                help={getForecastHorizonColumnHelp('trend', columnHelpCtx)}
                              />
                              <ForecastColumnHeader
                                label="品类"
                                help={getForecastHorizonColumnHelp('categoryCombined', columnHelpCtx)}
                              />
                            </>
                          )}
                          <ForecastColumnHeader
                            className="whitespace-nowrap"
                            label="系统"
                            help={getForecastHorizonColumnHelp('system', columnHelpCtx)}
                          />
                          <ForecastColumnHeader
                            className="whitespace-nowrap"
                            label="校准"
                            help={getForecastHorizonColumnHelp('calibration', columnHelpCtx)}
                          />
                          <ForecastColumnHeader
                            className="whitespace-nowrap"
                            label="生效"
                            help={getForecastHorizonColumnHelp('effective', columnHelpCtx)}
                          />
                        </tr>
                      </thead>
                      <tbody>
                        {displayRow.months.map((cell, monthIndex) => {
                          const v41 = cell.allCatV41Factors;
                          const t99Cell = isT99ForecastTier(profileSegment);
                          const diagnosticClass = t99Cell ? 'text-text-sub' : '';
                          const v41SystemTitle =
                            useV41DetailColumns &&
                            v41 &&
                            profileSegment &&
                            !t99Cell
                              ? buildV41SystemCellTitle({
                                  cell,
                                  v41,
                                  monthIndex,
                                  tier: profileSegment,
                                  productCategory:
                                    v41.productCategory ??
                                    skuMaster?.productCategory ??
                                    displayRow.forecastProfileClass,
                                  recent30DailyAvg: detail?.context?.recent30DailyAvg,
                                  recent90DailyAvg: detail?.context?.recent90DailyAvg,
                                })
                              : undefined;
                          return (
                          <tr key={cell.monthLabel} className="border-b border-border/60">
                            <td className="w-0 p-2 font-numeric whitespace-nowrap">
                              <span className="inline-flex items-center gap-1">
                                {cell.monthLabel}
                                {cell.aiAssistRationale ? (
                                  <span
                                    className={aiAssistBadgeClass(cell.aiAssistMode)}
                                    title={cell.aiAssistRationale}
                                  >
                                    {cell.aiAssistMode === 'human' ? 'AI+' : 'AI'}
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            <td className="p-2">{formatConfidenceLabel(cell.confidenceLevel)}</td>
                            <td className="p-2 font-numeric">{formatFactor(cell.baselineDailyAvg)}</td>
                            {useV41DetailColumns ? (
                              <>
                                {v41ColumnVisibility?.d6 ? (
                                  <td className={cn('p-2 font-numeric', diagnosticClass)}>
                                    {formatFactor(v41?.d6)}
                                  </td>
                                ) : null}
                                {v41ColumnVisibility?.trendRatio ? (
                                  <td className={cn('p-2 font-numeric', diagnosticClass)}>
                                    {formatFactor(v41?.trendRatio)}
                                  </td>
                                ) : null}
                                {v41ColumnVisibility?.anchor ? (
                                  <td
                                    className={cn('p-2 font-numeric', diagnosticClass)}
                                    title={t99Cell ? '诊断参考，不计入系统预测' : undefined}
                                  >
                                    {formatFactor(v41?.anchorDaily)}
                                  </td>
                                ) : null}
                                {v41ColumnVisibility?.seasonal ? (
                                  <td
                                    className={cn('p-2 font-numeric', diagnosticClass)}
                                    title={t99Cell ? '诊断参考，不计入系统预测' : undefined}
                                  >
                                    {formatFactor(v41?.seasonalDaily)}
                                  </td>
                                ) : null}
                                {v41ColumnVisibility?.blendLevel ? (
                                  <td
                                    className={cn('p-2 font-numeric', diagnosticClass)}
                                    title={t99Cell ? '诊断参考，不计入系统预测' : undefined}
                                  >
                                    {formatFactor(v41?.levelDaily)}
                                  </td>
                                ) : null}
                              </>
                            ) : (
                              <>
                                {showLegacyHorizonColumns && legacyHorizonColumns?.wNear ? (
                                  <td className="p-2 font-numeric">
                                    {cell.horizonFactors ? formatPct(cell.horizonFactors.wNear) : '-'}
                                  </td>
                                ) : null}
                                {showLegacyHorizonColumns && legacyHorizonColumns?.wYoy ? (
                                  <td className="p-2 font-numeric">
                                    {cell.horizonFactors ? formatPct(cell.horizonFactors.wYoy) : '-'}
                                  </td>
                                ) : null}
                                {showLegacyHorizonColumns && legacyHorizonColumns?.nearLevel ? (
                                  <td className="p-2 font-numeric">
                                    {formatFactor(cell.horizonFactors?.nearLevel)}
                                  </td>
                                ) : null}
                                {showLegacyHorizonColumns && legacyHorizonColumns?.structuralLevel ? (
                                  <td className="p-2 font-numeric">
                                    {formatFactor(cell.horizonFactors?.structuralLevel)}
                                  </td>
                                ) : null}
                                {showLegacyHorizonColumns && legacyHorizonColumns?.growthFactor ? (
                                  <td className="p-2 font-numeric">
                                    {formatFactor(cell.horizonFactors?.growthFactor)}
                                  </td>
                                ) : null}
                                {showLegacyHorizonColumns && legacyHorizonColumns?.yoyMonthLevel ? (
                                  <td className="p-2 font-numeric">
                                    {formatFactor(cell.horizonFactors?.yoyMonthLevel)}
                                  </td>
                                ) : null}
                                <td className="p-2 font-numeric">{formatFactor(cell.seasonalityFactor)}</td>
                                <td className="p-2 font-numeric">{formatFactor(cell.trendFactor)}</td>
                                <td
                                  className={cn(
                                    'p-2 font-numeric',
                                    cell.categoryTrendWasClipped ? 'text-amber-700 dark:text-amber-300' : '',
                                  )}
                                  title={
                                    cell.categoryTrendMatched
                                      ? undefined
                                      : '品类趋势表无匹配，展示默认 1.00'
                                  }
                                >
                                  {formatFactor(cell.categoryCombinedFactor)}
                                </td>
                              </>
                            )}
                            <CalibrationCells
                              cell={cell}
                              editable={canEditCalibration}
                              onSaved={invalidateForecast}
                              systemCellTitle={v41SystemTitle}
                            />
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                {(ctx || v41AnchoredSnapshot) && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium text-text-main">基线因子</h3>
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
                      {profileSegment && (
                        <p>
                          商品分层：<span className="font-medium text-primary">{profileSegmentLabel}</span>
                          <span className="ml-1 font-mono text-xs text-text-sub">({profileSegment})</span>
                        </p>
                      )}
                      {v41AnchoredSnapshot ? (
                        <p className="text-text-sub">
                          走步特征（触发时锚定，全周期一致）：
                          d6 <span className="font-numeric text-text-main">{formatNumber(v41AnchoredSnapshot.d6)}</span>
                          {' · '}
                          d3 <span className="font-numeric text-text-main">{formatNumber(v41AnchoredSnapshot.d3)}</span>
                          {' · '}
                          趋势比{' '}
                          <span className="font-numeric text-text-main">
                            {formatNumber(v41AnchoredSnapshot.trendRatio)}
                          </span>
                          {' · '}
                          锚定{' '}
                          <span className="font-numeric text-text-main">
                            {formatNumber(v41AnchoredSnapshot.anchorDaily)}
                          </span>
                          {v41AnchoredSnapshot.formula ? (
                            <>
                              {' · '}
                              公式{' '}
                              <span className="font-mono text-xs text-text-main">
                                {v41AnchoredSnapshot.formula.replace(/\*/g, '×')}
                              </span>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                      {ctx ? (
                        <>
                          <p>
                            生命周期权重（90d / 30d / 去年 / 品类）：{' '}
                            <span className="font-numeric">{ctx.weightsLabel}</span>
                          </p>
                          <p className="text-text-sub">
                            近 30 天日均 {formatNumber(ctx.recent30DailyAvg)}
                            {' · '}
                            近 90 天日均 {formatNumber(ctx.recent90DailyAvg)}
                            {' · '}
                            去年同月 {formatNumber(ctx.lastYearSameMonthDailyAvg)}
                            {' · '}
                            品类参考 {formatNumber(ctx.categoryReferenceDailyAvg)}
                            {ctx.storedBaselineDailyAvg != null && (
                              <>
                                {' · '}
                                生成基线 {formatNumber(ctx.storedBaselineDailyAvg)}
                              </>
                            )}
                          </p>
                        </>
                      ) : null}
                    </div>
                  </section>
                )}

                {(displayRow.historyMonths?.length ?? 0) > 0 && (
                  <section className="mb-1 rounded-md border border-border bg-muted/20">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-text-main hover:text-primary"
                      onClick={() => setHistoryExpanded((v) => !v)}
                      aria-expanded={historyExpanded}
                    >
                      <span>近 {DRAWER_HISTORY_MONTH_COUNT} 个月实际日均</span>
                      <span className="shrink-0 text-xs font-normal text-text-sub">
                        {historyExpanded ? '收起' : '展开'}
                      </span>
                    </button>
                    {historyExpanded && (
                      <div className="space-y-2 border-t border-border/60 px-3 pb-4 pt-2">
                        <p className="text-xs text-text-sub">
                          固定展示近 {DRAWER_HISTORY_MONTH_COUNT} 个月销量月表，按平台口径折算（件/天）；与上方预测月数无关。月份由近到远排列。
                        </p>
                        <div className="overflow-auto">
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="border-b border-border text-left text-text-sub">
                                <th className="p-2 font-normal">月份</th>
                                <th className="p-2 font-normal">月销量</th>
                                <th className="p-2 font-normal">实际日均</th>
                              </tr>
                            </thead>
                            <tbody>
                              {[...displayRow.historyMonths]
                                .sort(
                                  (a, b) =>
                                    b.forecastYear - a.forecastYear || b.month - a.month,
                                )
                                .map((cell) => (
                                <tr key={cell.monthLabel} className="border-b border-border/60">
                                  <td className="p-2 font-numeric whitespace-nowrap">{cell.monthLabel}</td>
                                  <td className="p-2 font-numeric">{cell.qtySold}</td>
                                  <td className="p-2 font-numeric">{formatNumber(cell.actualDailyAvg)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
