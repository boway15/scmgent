import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { DemandPlanSkuDetail, DemandPlanSkuWeeklyForecast } from '@/lib/api';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import {
  demandPlanPeriodHeaderTitle,
  formatDemandPlanDaily,
  formatDemandPlanPeriodLabel,
} from '@/lib/demand-plan-utils';
import {
  formatConfidenceLabel,
  formatTierDisplayLabel,
} from '@/lib/forecast-labels';
import {
  hasAnyLegacyHorizonColumn,
  isAiAssistForecastDetail,
  resolveAiAssistModeFromMonths,
  resolveLegacyHorizonColumnVisibility,
  resolveV41AnchoredSnapshot,
  resolveV41WAnchoredSnapshot,
  resolveV41DetailColumnVisibility,
} from '@/lib/forecast-detail-columns';
import {
  isAllCatV41ForecastCell,
  isT99ForecastTier,
} from '@/lib/forecast-horizon-display';
import {
  buildV41LevelCellTitle,
  buildV41SystemCellTitle,
} from '@/lib/forecast-v41-system-formula';
import { ForecastColumnHeader } from '@/components/ForecastColumnHeader';
import { HelpHintLabel } from '@/components/HelpHintLabel';
import {
  getForecastHorizonColumnHelp,
  type ForecastHorizonColumnHelpContext,
} from '@/lib/forecast-horizon-column-help';
import {
  DEMAND_PLAN_PLAN_CALIBRATION_COLUMN_HELP,
  DEMAND_PLAN_PLAN_EFFECTIVE_COLUMN_HELP,
  DEMAND_PLAN_PLAN_SYSTEM_COLUMN_HELP,
  DEMAND_PLAN_WEEKLY_FORECAST_SECTION_HELP,
} from '@/lib/demand-plan-column-help';
import { aiAssistBadgeClass } from '@/components/ForecastAssistPanel';
import { cn } from '@/lib/utils';

type Props = {
  versionId: string;
  platform?: string;
  forecastVersion: DemandPlanSkuDetail['forecastVersion'];
  forecastHorizon: DemandPlanSkuDetail['forecastHorizon'];
  forecastContext: DemandPlanSkuDetail['forecastContext'];
  weekRows: DemandPlanSkuWeeklyForecast[];
  productCategory?: string | null;
  planCalibrationEditable?: boolean;
  onPlanCalibrationSaved?: () => void;
};

function PlanWeekCalibrationCell({
  versionId,
  row,
  editable,
  onSaved,
}: {
  versionId: string;
  row: DemandPlanSkuWeeklyForecast;
  editable: boolean;
  onSaved?: () => void;
}) {
  const savedManual = row.planManualDailyAvg != null ? String(row.planManualDailyAvg) : '';
  const savedReason = row.planAdjustReason ?? '';
  const hasCalibration = row.planManualDailyAvg != null;

  const [manualInput, setManualInput] = useState(savedManual);
  const [reasonInput, setReasonInput] = useState(savedReason);
  const [reasonOpen, setReasonOpen] = useState(Boolean(savedReason));

  useEffect(() => {
    setManualInput(savedManual);
    setReasonInput(savedReason);
    setReasonOpen(Boolean(savedReason));
  }, [row.planWeekId, savedManual, savedReason]);

  const save = useMutation({
    mutationFn: async () => {
      if (!row.planWeekId) {
        throw new Error('该周计划行不存在，无法校准');
      }
      const trimmed = manualInput.trim();
      const manualDailyAvg = trimmed === '' ? null : Number(trimmed);
      if (manualDailyAvg != null && (!Number.isFinite(manualDailyAvg) || manualDailyAvg < 0)) {
        throw new Error('校准值须为 ≥0 的数字');
      }
      return api.updateDemandPlanWeek(versionId, row.planWeekId, {
        manualDailyAvg,
        adjustReason: reasonInput.trim(),
      });
    },
    onSuccess: () => onSaved?.(),
  });

  const isDirty = manualInput !== savedManual || reasonInput !== savedReason;

  const persistIfDirty = () => {
    if (!isDirty || save.isPending) return;
    save.mutate();
  };

  const clearCalibration = async () => {
    if (!row.planWeekId || save.isPending) return;
    await api.updateDemandPlanWeek(versionId, row.planWeekId, {
      manualDailyAvg: null,
      adjustReason: reasonInput.trim(),
    });
    setManualInput('');
    onSaved?.();
  };

  const showReasonUi =
    reasonOpen || hasCalibration || manualInput.trim() !== '' || Boolean(savedReason);

  if (!editable || !row.planWeekId) {
    return (
      <div className="font-numeric">
        <span className={hasCalibration ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-text-sub'}>
          {hasCalibration ? formatDemandPlanDaily(row.planManualDailyAvg!) : '—'}
        </span>
        {row.planAdjustReason ? (
          <div
            className="mt-0.5 max-w-[8rem] text-[10px] text-text-sub line-clamp-1"
            title={row.planAdjustReason}
          >
            {row.planAdjustReason}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="min-w-[5.5rem]">
      <div className="flex items-center gap-1.5">
        <Input
          type="text"
          inputMode="decimal"
          className={cn(
            'h-7 w-[4.5rem] px-2 font-numeric text-sm',
            hasCalibration && 'border-amber-400/60 dark:border-amber-500/50',
          )}
          placeholder="—"
          title="留空则使用系统预测；失焦或回车保存"
          value={manualInput}
          disabled={save.isPending}
          onChange={(event) => setManualInput(event.target.value)}
          onBlur={persistIfDirty}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault();
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              persistIfDirty();
            }
            if (event.key === 'Escape') {
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
            disabled={save.isPending}
            onClick={() => void clearCalibration()}
          >
            重置
          </button>
        ) : null}
      </div>
      {showReasonUi ? (
        reasonOpen ? (
          <Input
            className="mt-1 h-6 max-w-[8rem] px-2 text-[10px]"
            placeholder="备注（可选）"
            value={reasonInput}
            disabled={save.isPending}
            onChange={(event) => setReasonInput(event.target.value)}
            onBlur={persistIfDirty}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
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
        )
      ) : null}
      {save.isPending ? (
        <p className="mt-0.5 text-[10px] text-text-sub">保存中…</p>
      ) : null}
      {save.isError ? (
        <p className="mt-0.5 text-[10px] text-destructive">
          {save.error instanceof Error ? save.error.message : '保存失败'}
        </p>
      ) : null}
    </div>
  );
}

const formatFactor = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value.toFixed(2);

const formatPct = (value: number) => `${Math.round(value * 100)}%`;

const formatNumber = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value.toFixed(2);

export function DemandPlanWeeklyForecastTable({
  versionId,
  platform = 'ALL',
  forecastHorizon,
  forecastContext,
  weekRows,
  productCategory,
  planCalibrationEditable = false,
  onPlanCalibrationSaved,
}: Props) {
  const monthCells = forecastHorizon?.months ?? [];
  const planStoredTier =
    weekRows.find((row) => row.planBlendMeta?.profileSegment?.trim())?.planBlendMeta?.profileSegment ??
    null;
  const profileSegment =
    forecastHorizon?.profileSegment ??
    forecastContext?.profileSegment ??
    planStoredTier ??
    null;
  const aiAssistMode = resolveAiAssistModeFromMonths(monthCells);
  const profileSegmentLabel = formatTierDisplayLabel(profileSegment, aiAssistMode);
  const useV41DetailColumns = monthCells.some((cell) => isAllCatV41ForecastCell(cell));
  const v41AnchorFormula = useV41DetailColumns
    ? monthCells[0]?.allCatV41Factors?.formula
    : undefined;
  const columnHelpCtx: ForecastHorizonColumnHelpContext = {
    mode: useV41DetailColumns ? 'v41' : 'legacy',
    anchorFormula: v41AnchorFormula,
    tier: profileSegment,
    t99Diagnostic: isT99ForecastTier(profileSegment),
  };
  const isV41WPlan =
    weekRows.some((row) => row.planBlendMeta?.algo === 'v41_w') ||
    Boolean(forecastContext?.v41WalkForwardFactors);
  const v41AnchoredSnapshot = isV41WPlan
    ? resolveV41WAnchoredSnapshot(forecastContext?.v41WalkForwardFactors)
    : useV41DetailColumns
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
  const monthIndexByLabel = new Map(monthCells.map((cell, index) => [cell.monthLabel, index]));
  const confidenceLevel =
    monthCells.find((cell) => cell.confidenceLevel)?.confidenceLevel ??
    weekRows.find((row) => row.confidenceLevel)?.confidenceLevel ??
    null;
  const showMonthlyBlendMeta = weekRows.some((row) => row.planBlendMeta?.algo === 'monthly');

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium text-text-main">
          <HelpHintLabel
            label="周需求计划 · 26 周明细"
            help={DEMAND_PLAN_WEEKLY_FORECAST_SECTION_HELP}
          />
        </h3>
        <p className="text-xs text-text-sub">
          {useV41DetailColumns
            ? '置顶的是月预测用的分层和近几个月销量。计划系统在前 4 周会掺进最近真实每天卖几件，第 5 周起等于月预测摊到这一周的每天。'
            : isAiAssistDetail
              ? 'AI 辅助预测展示品类季节趋势与预测结果。'
              : 'legacy 模式展示近端/同比混合权重与品类季节趋势系数。'}
          {' 已发生周展示实际日均，便于对照生效日均；未来周为 -。'}
          {planCalibrationEditable ? (
            <span className="ml-1 text-text-main">草稿可在此校准人工日均。</span>
          ) : platform !== 'ALL' ? (
            <span className="ml-1">分平台视角为按月形状拆分的只读展示；如需校准请切换「全平台」或使用导入校准。</span>
          ) : null}
        </p>
      </div>

      {(forecastContext || v41AnchoredSnapshot || profileSegment) && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-medium text-text-main">基线锚点摘要</span>
            {profileSegment ? (
              <span>
                分层 <span className="font-medium text-primary">{profileSegmentLabel}</span>
                <span className="ml-1 font-mono text-xs text-text-sub">({profileSegment})</span>
              </span>
            ) : null}
            {confidenceLevel ? (
              <span className="text-text-sub">
                置信度 <span className="text-text-main">{formatConfidenceLabel(confidenceLevel)}</span>
              </span>
            ) : null}
            {forecastContext ? (
              <span className="text-text-sub">
                近 30 天 <span className="font-numeric text-text-main">{formatNumber(forecastContext.recent30DailyAvg)}</span>
                {' · '}
                近 90 天 <span className="font-numeric text-text-main">{formatNumber(forecastContext.recent90DailyAvg)}</span>
              </span>
            ) : null}
          </div>
          {v41AnchoredSnapshot ? (
            <p className="text-text-sub">
              走步特征（全周期共用）：
              {isV41WPlan ? 'w8' : 'd6'}{' '}
              <span className="font-numeric text-text-main">{formatNumber(v41AnchoredSnapshot.d6)}</span>
              {' · '}
              {isV41WPlan ? 'w4' : 'd3'}{' '}
              <span className="font-numeric text-text-main">{formatNumber(v41AnchoredSnapshot.d3)}</span>
              {' · '}
              趋势比{' '}
              <span className="font-numeric text-text-main">{formatNumber(v41AnchoredSnapshot.trendRatio)}</span>
              {' · '}
              锚定日均{' '}
              <span className="font-numeric text-text-main">{formatNumber(v41AnchoredSnapshot.anchorDaily)}</span>
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
          ) : forecastContext ? (
            <p className="text-text-sub">
              权重 {forecastContext.weightsLabel}
            </p>
          ) : null}
        </div>
      )}

      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-sub">
              <ForecastColumnHeader className="w-0 whitespace-nowrap" label="周次" />
              {useV41DetailColumns ? (
                <>
                  {v41ColumnVisibility?.seasonal ? (
                    <ForecastColumnHeader
                      label="季节朴素"
                      help={getForecastHorizonColumnHelp('seasonal', columnHelpCtx)}
                    />
                  ) : null}
                  <ForecastColumnHeader
                    label="混合基线"
                    help={getForecastHorizonColumnHelp('blendLevel', columnHelpCtx)}
                  />
                </>
              ) : (
                <>
                  <ForecastColumnHeader
                    label="混合基线"
                    help={getForecastHorizonColumnHelp('baseline', columnHelpCtx)}
                  />
                  {showLegacyHorizonColumns && legacyHorizonColumns?.wNear ? (
                    <ForecastColumnHeader label="w近" help={getForecastHorizonColumnHelp('wNear', columnHelpCtx)} />
                  ) : null}
                  {showLegacyHorizonColumns && legacyHorizonColumns?.wYoy ? (
                    <ForecastColumnHeader label="w同比" help={getForecastHorizonColumnHelp('wYoy', columnHelpCtx)} />
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
                  <ForecastColumnHeader label="趋势" help={getForecastHorizonColumnHelp('trend', columnHelpCtx)} />
                  <ForecastColumnHeader
                    label="品类"
                    help={getForecastHorizonColumnHelp('categoryCombined', columnHelpCtx)}
                  />
                </>
              )}
              <ForecastColumnHeader
                className="whitespace-nowrap"
                label="系统预测"
                help={DEMAND_PLAN_PLAN_SYSTEM_COLUMN_HELP}
              />
              <ForecastColumnHeader
                className="whitespace-nowrap"
                label="人工校准"
                help={DEMAND_PLAN_PLAN_CALIBRATION_COLUMN_HELP}
              />
              <ForecastColumnHeader
                className="whitespace-nowrap"
                label="生效日均"
                help={DEMAND_PLAN_PLAN_EFFECTIVE_COLUMN_HELP}
              />
              <ForecastColumnHeader
                className="whitespace-nowrap"
                label="实际日均"
                help={getForecastHorizonColumnHelp('actual', columnHelpCtx)}
                helpAlign="end"
              />
            </tr>
          </thead>
          <tbody>
            {weekRows.map((row) => {
              const anchorCell = monthCells.find((cell) => cell.monthLabel === row.anchorMonthLabel);
              const monthIndex = monthIndexByLabel.get(row.anchorMonthLabel) ?? 0;
              const v41 = row.allCatV41Factors;
              const t99Cell = isT99ForecastTier(profileSegment);
              const diagnosticClass = t99Cell ? 'text-text-sub' : '';
              const helpCellClass =
                'cursor-help underline decoration-dotted decoration-text-sub/40 underline-offset-2';
              const v41SystemTitle =
                useV41DetailColumns && v41 && profileSegment && anchorCell && !t99Cell
                  ? [
                      buildV41SystemCellTitle({
                        cell: anchorCell,
                        v41,
                        monthIndex,
                        tier: profileSegment,
                        productCategory:
                          v41.productCategory ?? productCategory ?? forecastHorizon?.forecastProfileClass,
                        recent30DailyAvg: forecastContext?.recent30DailyAvg,
                        recent90DailyAvg: forecastContext?.recent90DailyAvg,
                      }),
                      `周系统预测 = 月系统按 ISO 周日历天权重拆分（锚月 ${row.anchorMonthLabel}）`,
                    ]
                      .filter(Boolean)
                      .join('\n')
                  : `周系统预测 = 月系统按 ISO 周日历天权重拆分（锚月 ${row.anchorMonthLabel}）`;
              const levelTitleOpts =
                useV41DetailColumns && v41 && anchorCell
                  ? {
                      cell: anchorCell,
                      v41,
                      monthIndex,
                      tier: profileSegment,
                      diagnosticOnly: t99Cell,
                    }
                  : null;
              const planCalibrated = row.planManualDailyAvg != null;
              const systemDisplay =
                row.planSystemDailyAvg != null
                  ? formatDemandPlanDaily(row.planSystemDailyAvg)
                  : formatNumber(row.systemDailyAvg);
              const effectiveDisplay =
                row.planEffectiveDailyAvg != null
                  ? formatDemandPlanDaily(row.planEffectiveDailyAvg)
                  : formatNumber(row.effectiveDailyAvg);
              const blendBaselineValue = v41?.levelDaily ?? row.baselineDailyAvg;
              const blendBaselineTitle = levelTitleOpts
                ? buildV41LevelCellTitle({ ...levelTitleOpts, kind: 'blend' }) ||
                  buildV41LevelCellTitle({ ...levelTitleOpts, kind: 'baseline' })
                : undefined;

              return (
                <tr key={row.weekKey} className="border-b border-border/60">
                  <td
                    className="w-0 p-2 font-mono whitespace-nowrap"
                    title={demandPlanPeriodHeaderTitle(row.weekKey, 'week')}
                  >
                    <span className="inline-flex items-center gap-1">
                      {formatDemandPlanPeriodLabel(row.weekKey, 'week')}
                      {row.aiAssistRationale ? (
                        <span
                          className={aiAssistBadgeClass(row.aiAssistMode)}
                          title={row.aiAssistRationale}
                        >
                          {row.aiAssistMode === 'human' ? 'AI+' : 'AI'}
                        </span>
                      ) : null}
                    </span>
                    <div className="text-[10px] text-text-sub">锚月 {row.anchorMonthLabel}</div>
                  </td>
                  {useV41DetailColumns ? (
                    <>
                      {v41ColumnVisibility?.seasonal ? (
                        <td
                          className={cn(
                            'p-2 font-numeric',
                            diagnosticClass,
                            levelTitleOpts &&
                              buildV41LevelCellTitle({ ...levelTitleOpts, kind: 'seasonal' }) &&
                              helpCellClass,
                          )}
                          title={
                            levelTitleOpts
                              ? buildV41LevelCellTitle({ ...levelTitleOpts, kind: 'seasonal' })
                              : undefined
                          }
                        >
                          {formatFactor(v41?.seasonalDaily)}
                        </td>
                      ) : null}
                      <td
                        className={cn(
                          'p-2 font-numeric',
                          diagnosticClass,
                          blendBaselineTitle && helpCellClass,
                        )}
                        title={blendBaselineTitle}
                      >
                        {formatFactor(blendBaselineValue)}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-2 font-numeric">{formatFactor(row.baselineDailyAvg)}</td>
                      {showLegacyHorizonColumns && legacyHorizonColumns?.wNear ? (
                        <td className="p-2 font-numeric">
                          {row.horizonFactors ? formatPct(row.horizonFactors.wNear) : '-'}
                        </td>
                      ) : null}
                      {showLegacyHorizonColumns && legacyHorizonColumns?.wYoy ? (
                        <td className="p-2 font-numeric">
                          {row.horizonFactors ? formatPct(row.horizonFactors.wYoy) : '-'}
                        </td>
                      ) : null}
                      {showLegacyHorizonColumns && legacyHorizonColumns?.nearLevel ? (
                        <td className="p-2 font-numeric">{formatFactor(row.horizonFactors?.nearLevel)}</td>
                      ) : null}
                      {showLegacyHorizonColumns && legacyHorizonColumns?.structuralLevel ? (
                        <td className="p-2 font-numeric">{formatFactor(row.horizonFactors?.structuralLevel)}</td>
                      ) : null}
                      {showLegacyHorizonColumns && legacyHorizonColumns?.growthFactor ? (
                        <td className="p-2 font-numeric">{formatFactor(row.horizonFactors?.growthFactor)}</td>
                      ) : null}
                      {showLegacyHorizonColumns && legacyHorizonColumns?.yoyMonthLevel ? (
                        <td className="p-2 font-numeric">{formatFactor(row.horizonFactors?.yoyMonthLevel)}</td>
                      ) : null}
                      <td className="p-2 font-numeric">{formatFactor(row.seasonalityFactor)}</td>
                      <td className="p-2 font-numeric">{formatFactor(row.trendFactor)}</td>
                      <td
                        className={cn(
                          'p-2 font-numeric',
                          row.categoryTrendWasClipped ? 'text-amber-700 dark:text-amber-300' : '',
                        )}
                        title={row.categoryTrendMatched ? undefined : '品类趋势表无匹配，展示默认 1.00'}
                      >
                        {formatFactor(row.categoryCombinedFactor)}
                      </td>
                    </>
                  )}
                  <td
                    className={cn(
                      'p-2 font-numeric whitespace-nowrap text-text-sub',
                      v41SystemTitle && helpCellClass,
                    )}
                    title={v41SystemTitle}
                  >
                    {systemDisplay}
                  </td>
                  <td className="p-2 align-middle whitespace-nowrap">
                    <PlanWeekCalibrationCell
                      key={`${row.weekKey}-${row.planManualDailyAvg ?? ''}-${row.planAdjustReason ?? ''}`}
                      versionId={versionId}
                      row={row}
                      editable={planCalibrationEditable}
                      onSaved={onPlanCalibrationSaved}
                    />
                  </td>
                  <td
                    className={cn(
                      'p-2 font-numeric whitespace-nowrap',
                      planCalibrated
                        ? 'font-medium text-amber-700 dark:text-amber-300'
                        : Number(row.planEffectiveDailyAvg ?? row.effectiveDailyAvg) > 0
                          ? 'text-primary'
                          : 'text-text-sub',
                    )}
                  >
                    {effectiveDisplay}
                  </td>
                  <td className="p-2 align-middle font-numeric whitespace-nowrap">
                    {row.actualDailyAvg == null ? (
                      '-'
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span>{formatNumber(row.actualDailyAvg)}</span>
                        {row.actualInProgress ? (
                          <span className="text-[10px] font-normal text-text-sub">进行中</span>
                        ) : null}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showMonthlyBlendMeta ? (
        <details className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-text-main">周系统合成（blend_meta）</summary>
          <div className="mt-2 max-h-48 overflow-auto">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-left text-text-sub">
                  <th className="p-1 font-normal">周</th>
                  <th className="p-1 font-normal">idx</th>
                  <th className="p-1 font-normal">U</th>
                  <th className="p-1 font-normal">w近</th>
                  <th className="p-1 font-normal">w远</th>
                  <th className="p-1 font-normal">F_w</th>
                </tr>
              </thead>
              <tbody>
                {weekRows.map((row) => {
                  const meta = row.planBlendMeta;
                  if (!meta) return null;
                  return (
                    <tr key={`blend-${row.weekKey}`} className="border-t border-border/40 font-numeric">
                      <td className="p-1 font-mono">{formatDemandPlanPeriodLabel(row.weekKey, 'week')}</td>
                      <td className="p-1">{meta.weekIndex}</td>
                      <td className="p-1">{formatNumber(meta.U)}</td>
                      <td className="p-1">{formatPct(meta.wNear)}</td>
                      <td className="p-1">{formatPct(meta.wYoy)}</td>
                      <td className="p-1">{formatNumber(meta.weekForecastDaily)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </section>
  );
}
