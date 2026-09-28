import type { DemandPlanSkuDetail, DemandPlanSkuWeeklyForecast } from '@/lib/api';
import { formatDemandPlanDaily } from '@/lib/demand-plan-utils';
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
  DEMAND_PLAN_CHAMPION_COLUMN_HELP,
  DEMAND_PLAN_PLAN_EFFECTIVE_COLUMN_HELP,
  DEMAND_PLAN_WEEKLY_FORECAST_SECTION_HELP,
} from '@/lib/demand-plan-column-help';
import { aiAssistBadgeClass } from '@/components/ForecastAssistPanel';
import { cn } from '@/lib/utils';

type Props = {
  forecastVersion: DemandPlanSkuDetail['forecastVersion'];
  forecastHorizon: DemandPlanSkuDetail['forecastHorizon'];
  forecastContext: DemandPlanSkuDetail['forecastContext'];
  weekRows: DemandPlanSkuWeeklyForecast[];
  productCategory?: string | null;
};

const formatFactor = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value.toFixed(2);

const formatPct = (value: number) => `${Math.round(value * 100)}%`;

const formatNumber = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value.toFixed(2);

export function DemandPlanWeeklyForecastTable({
  forecastVersion,
  forecastHorizon,
  forecastContext,
  weekRows,
  productCategory,
}: Props) {
  const monthCells = forecastHorizon?.months ?? [];
  const profileSegment = forecastHorizon?.profileSegment ?? forecastContext?.profileSegment ?? null;
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
  const v41AnchoredSnapshot = useV41DetailColumns ? resolveV41AnchoredSnapshot(monthCells) : null;
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

  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-text-main">
        <HelpHintLabel
          label="未来 6 月预测 · 周维度"
          help={DEMAND_PLAN_WEEKLY_FORECAST_SECTION_HELP}
        />
      </h3>
      <p className="text-xs text-text-sub">
        系统/生效列由月预测按 ISO 周日历天权重拆周；因子列取周锚定月（周一所在月），与销量预测明细一致。
        {useV41DetailColumns
          ? ' V4.1 走步特征 d6/趋势比/锚定见下方基线因子。'
          : isAiAssistDetail
            ? ' AI 辅助预测展示品类季节趋势与预测结果。'
            : ' legacy 模式展示近端/同比混合权重与品类季节趋势系数。'}
        {' 已发生周展示实际日均；未来周为 -。'}
        {forecastVersion ? (
          <span className="ml-1 font-mono">预测版本 {forecastVersion.versionNo}</span>
        ) : (
          <span className="ml-1">暂无已发布销量预测。</span>
        )}
      </p>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-text-sub">
              <ForecastColumnHeader className="w-0 whitespace-nowrap" label="周次" />
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
                    <ForecastColumnHeader label="d6" help={getForecastHorizonColumnHelp('d6', columnHelpCtx)} />
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
              <ForecastColumnHeader
                className="whitespace-nowrap"
                label="实际日均"
                help={getForecastHorizonColumnHelp('actual', columnHelpCtx)}
              />
              <ForecastColumnHeader
                className="whitespace-nowrap"
                label="计划生效"
                help={DEMAND_PLAN_PLAN_EFFECTIVE_COLUMN_HELP}
              />
              <ForecastColumnHeader
                className="whitespace-nowrap"
                label="Champion"
                help={DEMAND_PLAN_CHAMPION_COLUMN_HELP}
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
                  ? buildV41SystemCellTitle({
                      cell: anchorCell,
                      v41,
                      monthIndex,
                      tier: profileSegment,
                      productCategory:
                        v41.productCategory ?? productCategory ?? forecastHorizon?.forecastProfileClass,
                      recent30DailyAvg: forecastContext?.recent30DailyAvg,
                      recent90DailyAvg: forecastContext?.recent90DailyAvg,
                    })
                  : `周系统 = 月系统按日历天权重拆分（锚月 ${row.anchorMonthLabel}）`;
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

              return (
                <tr key={row.weekKey} className="border-b border-border/60">
                  <td className="w-0 p-2 font-mono whitespace-nowrap">
                    <span className="inline-flex items-center gap-1">
                      {row.weekKey}
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
                  <td className="p-2">{formatConfidenceLabel(row.confidenceLevel)}</td>
                  <td
                    className={cn(
                      'p-2 font-numeric',
                      levelTitleOpts && buildV41LevelCellTitle({ ...levelTitleOpts, kind: 'baseline' }) && helpCellClass,
                    )}
                    title={
                      levelTitleOpts
                        ? buildV41LevelCellTitle({ ...levelTitleOpts, kind: 'baseline' })
                        : undefined
                    }
                  >
                    {formatFactor(row.baselineDailyAvg)}
                  </td>
                  {useV41DetailColumns ? (
                    <>
                      {v41ColumnVisibility?.d6 ? (
                        <td className={cn('p-2 font-numeric', diagnosticClass)}>{formatFactor(v41?.d6)}</td>
                      ) : null}
                      {v41ColumnVisibility?.trendRatio ? (
                        <td className={cn('p-2 font-numeric', diagnosticClass)}>
                          {formatFactor(v41?.trendRatio)}
                        </td>
                      ) : null}
                      {v41ColumnVisibility?.anchor ? (
                        <td
                          className={cn('p-2 font-numeric', diagnosticClass, v41?.anchorDaily != null && helpCellClass)}
                          title={
                            v41?.anchorDaily != null
                              ? ['【锚定日均 · 算法】', `锚月 ${row.anchorMonthLabel}`, `→ 锚定 ${formatFactor(v41.anchorDaily)}`].join('\n')
                              : undefined
                          }
                        >
                          {formatFactor(v41?.anchorDaily)}
                        </td>
                      ) : null}
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
                      {v41ColumnVisibility?.blendLevel ? (
                        <td
                          className={cn(
                            'p-2 font-numeric',
                            diagnosticClass,
                            levelTitleOpts &&
                              buildV41LevelCellTitle({ ...levelTitleOpts, kind: 'blend' }) &&
                              helpCellClass,
                          )}
                          title={
                            levelTitleOpts
                              ? buildV41LevelCellTitle({ ...levelTitleOpts, kind: 'blend' })
                              : undefined
                          }
                        >
                          {formatFactor(v41?.levelDaily)}
                        </td>
                      ) : null}
                    </>
                  ) : (
                    <>
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
                    {formatNumber(row.systemDailyAvg)}
                  </td>
                  <td className="p-2 font-numeric whitespace-nowrap text-text-sub">
                    {row.hasManual ? formatNumber(row.manualDailyAvg) : '—'}
                  </td>
                  <td className="p-2 font-numeric whitespace-nowrap">
                    <span
                      className={cn(
                        row.hasManual && 'font-medium text-amber-700 dark:text-amber-300',
                        !row.hasManual && 'text-primary',
                      )}
                    >
                      {formatNumber(row.effectiveDailyAvg)}
                    </span>
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
                  <td
                    className={cn(
                      'p-2 font-numeric',
                      planCalibrated
                        ? 'text-amber-700 dark:text-amber-300'
                        : Number(row.planEffectiveDailyAvg) > 0
                          ? 'text-primary'
                          : 'text-text-sub',
                    )}
                  >
                    {row.planEffectiveDailyAvg ? formatDemandPlanDaily(row.planEffectiveDailyAvg) : '—'}
                  </td>
                  <td className="p-2 font-numeric text-text-sub">
                    {row.championForecastDaily ? formatDemandPlanDaily(row.championForecastDaily) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {(forecastContext || v41AnchoredSnapshot) && (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm space-y-1">
          <p className="font-medium text-text-main">基线因子</p>
          {profileSegment ? (
            <p>
              商品分层：<span className="font-medium text-primary">{profileSegmentLabel}</span>
              <span className="ml-1 font-mono text-xs text-text-sub">({profileSegment})</span>
            </p>
          ) : null}
          {v41AnchoredSnapshot ? (
            <p className="text-text-sub">
              走步特征（触发时锚定，全周期一致）：
              d6 <span className="font-numeric text-text-main">{formatNumber(v41AnchoredSnapshot.d6)}</span>
              {' · '}
              d3 <span className="font-numeric text-text-main">{formatNumber(v41AnchoredSnapshot.d3)}</span>
              {' · '}
              趋势比{' '}
              <span className="font-numeric text-text-main">{formatNumber(v41AnchoredSnapshot.trendRatio)}</span>
              {' · '}
              锚定{' '}
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
              近 30 天 {formatNumber(forecastContext.recent30DailyAvg)} · 近 90 天{' '}
              {formatNumber(forecastContext.recent90DailyAvg)} · 权重 {forecastContext.weightsLabel}
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
