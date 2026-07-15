import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { ListPagination } from '@/components/ListPagination';
import {
  formatConfidenceLabel,
  formatLifecycleLabel,
  formatTierDisplayLabel,
} from '@/lib/forecast-labels';
import { resolveAiAssistModeFromMonths } from '@/lib/forecast-detail-columns';
import {
  FORECAST_HORIZON_FUTURE_MONTH_OPTIONS,
  FORECAST_HORIZON_HISTORY_MONTH_OPTIONS,
  resolveHorizonPlatformScope,
} from '@/lib/forecast-horizon-meta';
import { isAllCatV41ForecastCell, isT99ForecastTier } from '@/lib/forecast-horizon-display';
import { cn } from '@/lib/utils';
import type { ForecastHorizonRow } from '@/components/ForecastSkuDetailDrawer';

export type ForecastHorizonViewMode = 'future' | 'history' | 'detail';

const formatFactor = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '-' : value.toFixed(2);

const cellEffective = (cell: {
  effectiveDailyAvg?: number;
  manualDailyAvg?: number | null;
  forecastDailyAvg: number;
}) =>
  cell.effectiveDailyAvg ??
  (cell.manualDailyAvg != null ? cell.manualDailyAvg : cell.forecastDailyAvg);

const cellDailyTitle = (cell: {
  forecastDailyAvg: number;
  manualDailyAvg?: number | null;
  effectiveDailyAvg?: number;
  horizonFactors?: ForecastHorizonRow['months'][0]['horizonFactors'];
  allCatV41Factors?: ForecastHorizonRow['months'][0]['allCatV41Factors'];
  baselineDailyAvg: number | null;
  categoryCombinedFactor: number;
}, rowProfileSegment?: string | null) => {
  const effective = cellEffective(cell);
  const parts = [`生效 ${formatFactor(effective)}`];
  if (cell.manualDailyAvg != null) {
    parts.push(`校准 ${formatFactor(cell.manualDailyAvg)}`, `系统 ${formatFactor(cell.forecastDailyAvg)}`);
  }
  const tier = rowProfileSegment;
  if (tier === 'T99' && cell.manualDailyAvg == null && cell.forecastDailyAvg === 0) {
    parts.push('待校准');
  }
  if (cell.allCatV41Factors) {
    parts.push(
      `d6 ${formatFactor(cell.allCatV41Factors.d6)}`,
    );
    if (cell.allCatV41Factors.seasonalDaily != null) {
      parts.push(`季节朴素 ${formatFactor(cell.allCatV41Factors.seasonalDaily)}`);
    }
  } else if (cell.horizonFactors) {
    parts.push(
      `w近${formatPct(cell.horizonFactors.wNear)} w同比${formatPct(cell.horizonFactors.wYoy)}`,
    );
  } else {
    parts.push(`基线 ${formatFactor(cell.baselineDailyAvg)}`);
  }
  return parts.join(' · ');
};

const formatPct = (value: number) => `${Math.round(value * 100)}%`;

type QueryFilters = {
  versionId?: string;
  skuCode?: string;
  platform?: string;
  category?: string;
  profileSegment?: string;
  pendingCalibration?: boolean;
};

type Props = {
  active: boolean;
  filters: QueryFilters;
  pageSize?: number;
  onSkuClick?: (row: ForecastHorizonRow, ctx: { platform: string }) => void;
};

export function ForecastHorizonPanel({ active, filters, pageSize = 20, onSkuClick }: Props) {
  const [viewMode, setViewMode] = useState<ForecastHorizonViewMode>('future');
  const [monthCount, setMonthCount] = useState(6);
  const [page, setPage] = useState(1);
  const [pageSizeState, setPageSizeState] = useState(pageSize);

  const { data: horizon, isLoading } = useQuery({
    queryKey: [
      'sales-forecast-horizon',
      filters,
      page,
      pageSizeState,
      monthCount,
      viewMode,
    ],
    queryFn: () =>
      api.getSalesForecastHorizon({
        versionId: filters.versionId,
        skuCode: filters.skuCode || undefined,
        platform: resolveHorizonPlatformScope(filters.platform),
        category: filters.category || undefined,
        profileSegment: filters.profileSegment || undefined,
        pendingCalibration: filters.pendingCalibration || undefined,
        page,
        pageSize: pageSizeState,
        monthCount: viewMode === 'history' ? undefined : monthCount,
        historyMonthCount: viewMode === 'future' ? 0 : monthCount,
      }),
    enabled: active && Boolean(filters.versionId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const renderSkuCell = (row: ForecastHorizonRow) => {
    if (onSkuClick) {
      return (
        <button
          type="button"
          className="text-left hover:text-primary"
          onClick={() => onSkuClick(row, { platform: resolveHorizonPlatformScope(filters.platform) })}
        >
          <div className="font-medium text-primary underline-offset-2 hover:underline">{row.skuCode}</div>
          <div className="max-w-[140px] truncate text-xs text-text-sub" title={row.skuName}>
            {row.skuName}
          </div>
        </button>
      );
    }
    return (
      <>
        <div className="font-medium">{row.skuCode}</div>
        <div className="max-w-[140px] truncate text-xs text-text-sub" title={row.skuName}>
          {row.skuName}
        </div>
      </>
    );
  };

  if (!active) return null;

  const useV41DetailColumns = Boolean(
    horizon?.items.some((row) => row.months.some((cell) => isAllCatV41ForecastCell(cell))),
  );
  const detailFactorColCount = useV41DetailColumns ? 4 : 7;
  const historyPadding = Array.from({ length: detailFactorColCount + 2 }, () => '-');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <select
          className="h-9 rounded-md border border-border bg-card px-3 text-sm"
          value={monthCount}
          onChange={(e) => {
            setMonthCount(Number(e.target.value));
            setPage(1);
          }}
        >
          {(viewMode === 'history'
            ? FORECAST_HORIZON_HISTORY_MONTH_OPTIONS
            : FORECAST_HORIZON_FUTURE_MONTH_OPTIONS
          ).map((n) => (
            <option key={n} value={n}>
              {viewMode === 'future'
                ? `未来 ${n} 个月`
                : viewMode === 'history'
                  ? `历史 ${n} 个月`
                  : `各 ${n} 个月`}
            </option>
          ))}
        </select>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={viewMode === 'future' ? 'default' : 'outline'}
            onClick={() => setViewMode('future')}
          >
            未来
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'history' ? 'default' : 'outline'}
            onClick={() => setViewMode('history')}
          >
            历史
          </Button>
          <Button
            size="sm"
            variant={viewMode === 'detail' ? 'default' : 'outline'}
            onClick={() => setViewMode('detail')}
          >
            明细
          </Button>
        </div>
      </div>

      {isLoading ? (
        <p className="text-text-sub">加载中…</p>
      ) : !horizon || horizon.total === 0 ? (
        <p className="text-sm text-text-sub">
          暂无预测数据。
          {filters.platform?.trim() && resolveHorizonPlatformScope(filters.platform) !== 'ALL' && (
            <span> 可尝试将渠道改为「全渠道汇总」，或确认该渠道在销量历史中已有数据。</span>
          )}
        </p>
      ) : viewMode === 'future' ? (
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="sticky left-0 z-10 bg-card p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">渠道</th>
                <th className="p-2 font-normal">生命周期</th>
                <th className="p-2 font-normal">分层</th>
                {(horizon.horizon ?? []).map((col) => (
                  <th key={col.monthLabel} className="p-2 font-normal whitespace-nowrap">
                    {col.monthLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {horizon.items.map((row) => (
                <tr key={`${row.skuId}:${row.station}:${row.platform}`} className="border-b border-border/60">
                  <td className="sticky left-0 z-10 bg-card p-2">{renderSkuCell(row)}</td>
                  <td className="p-2">{row.platform}</td>
                  <td className="p-2 text-text-sub">{formatLifecycleLabel(row.lifecycle)}</td>
                  <td className="p-2 text-xs text-text-sub whitespace-nowrap" title={row.profileSegment ?? undefined}>
                    {row.profileSegment
                      ? formatTierDisplayLabel(
                          row.profileSegment,
                          resolveAiAssistModeFromMonths(row.months),
                        )
                      : '-'}
                  </td>
                  {(horizon.horizon ?? []).map((col) => {
                    const cell = row.months.find((m) => m.monthLabel === col.monthLabel);
                    const effective = cell ? cellEffective(cell) : 0;
                    const calibrated = cell?.manualDailyAvg != null;
                    const tier = row.profileSegment;
                    const t99Pending =
                      isT99ForecastTier(tier) &&
                      effective === 0 &&
                      !calibrated &&
                      (cell?.forecastDailyAvg ?? 0) === 0;
                    return (
                    <td
                      key={col.monthLabel}
                      className={cn(
                        'p-2 text-center font-numeric',
                        effective > 0 ? (calibrated ? 'text-amber-700 dark:text-amber-300' : 'text-primary') : 'text-text-sub',
                      )}
                      title={cell ? cellDailyTitle(cell, row.profileSegment) : '暂无预测'}
                    >
                      {cell ? formatFactor(effective) : '—'}
                      {calibrated && (
                        <div className="text-[10px] text-text-sub font-normal">校</div>
                      )}
                      {t99Pending && (
                        <div className="text-[10px] text-amber-700 dark:text-amber-300 font-normal">待校准</div>
                      )}
                    </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : viewMode === 'history' ? (
        <div className="overflow-auto">
          <p className="mb-2 text-xs text-text-sub">
            历史为销量月表折算日均（件/天），按渠道汇总。
          </p>
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="sticky left-0 z-10 bg-card p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">渠道</th>
                <th className="p-2 font-normal">生命周期</th>
                {(horizon.historyHorizon ?? []).map((col) => (
                  <th key={col.monthLabel} className="p-2 font-normal whitespace-nowrap">
                    {col.monthLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {horizon.items.map((row) => (
                <tr key={`hist-${row.skuId}:${row.station}:${row.platform}`} className="border-b border-border/60">
                  <td className="sticky left-0 z-10 bg-card p-2">{renderSkuCell(row)}</td>
                  <td className="p-2">{row.platform}</td>
                  <td className="p-2 text-text-sub">{formatLifecycleLabel(row.lifecycle)}</td>
                  {(row.historyMonths ?? []).map((cell) => (
                    <td
                      key={cell.monthLabel}
                      className={cn(
                        'p-2 text-center font-numeric',
                        cell.actualDailyAvg > 0 ? 'text-text-main' : 'text-text-sub',
                      )}
                      title={`月销量 ${cell.qtySold} 件`}
                    >
                      {formatFactor(cell.actualDailyAvg)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-text-sub">
                <th className="p-2 font-normal">时段</th>
                <th className="p-2 font-normal">SKU</th>
                <th className="p-2 font-normal">渠道</th>
                <th className="p-2 font-normal">绝对月</th>
                <th className="p-2 font-normal">生命周期</th>
                <th className="p-2 font-normal">置信度</th>
                <th className="p-2 font-normal">基线日均</th>
                {useV41DetailColumns ? (
                  <>
                    <th className="p-2 font-normal">T层</th>
                    <th className="p-2 font-normal">d6</th>
                    <th className="p-2 font-normal">趋势比</th>
                    <th className="p-2 font-normal">季节朴素</th>
                  </>
                ) : (
                  <>
                    <th className="p-2 font-normal">w近</th>
                    <th className="p-2 font-normal">近端</th>
                    <th className="p-2 font-normal">结构</th>
                    <th className="p-2 font-normal">增长</th>
                    <th className="p-2 font-normal">季节系数</th>
                    <th className="p-2 font-normal">趋势系数</th>
                    <th className="p-2 font-normal">品类综合</th>
                  </>
                )}
                <th className="p-2 font-normal">生效日均</th>
                <th className="p-2 font-normal">系统预测</th>
                <th className="p-2 font-normal">校准值</th>
              </tr>
            </thead>
            <tbody>
              {horizon.items.flatMap((row) => [
                ...(row.historyMonths ?? []).map((cell) => (
                  <tr
                    key={`hist-${row.skuId}-${row.station}-${row.platform}-${cell.monthLabel}`}
                    className="border-b border-border/60"
                  >
                    <td className="p-2 text-text-sub">历史</td>
                    <td className="p-2">
                      {onSkuClick ? (
                        <button
                          type="button"
                          className="text-left text-primary hover:underline"
                          onClick={() =>
                            onSkuClick(row, { platform: resolveHorizonPlatformScope(filters.platform) })
                          }
                        >
                          {row.skuCode}
                        </button>
                      ) : (
                        row.skuCode
                      )}
                      <div className="max-w-[120px] truncate text-xs text-text-sub" title={row.category ?? ''}>
                        {row.category ?? '-'}
                      </div>
                    </td>
                    <td className="p-2 whitespace-nowrap">{row.platform}</td>
                    <td className="p-2 font-numeric whitespace-nowrap">{cell.monthLabel}</td>
                    <td className="p-2">{formatLifecycleLabel(row.lifecycle)}</td>
                    {historyPadding.map((pad, idx) => (
                      <td key={`hist-pad-${cell.monthLabel}-${idx}`} className="p-2">
                        {pad}
                      </td>
                    ))}
                    <td className="p-2 font-numeric">{formatFactor(cell.actualDailyAvg)}</td>
                  </tr>
                )),
                ...row.months.map((cell) => (
                  <tr
                    key={`fut-${row.skuId}-${row.station}-${row.platform}-${cell.monthLabel}`}
                    className="border-b border-border/60"
                  >
                    <td className="p-2 text-text-sub">未来</td>
                    <td className="p-2">
                      {onSkuClick ? (
                        <button
                          type="button"
                          className="text-left text-primary hover:underline"
                          onClick={() =>
                            onSkuClick(row, { platform: resolveHorizonPlatformScope(filters.platform) })
                          }
                        >
                          {row.skuCode}
                        </button>
                      ) : (
                        row.skuCode
                      )}
                      <div className="max-w-[120px] truncate text-xs text-text-sub" title={row.category ?? ''}>
                        {row.category ?? '-'}
                      </div>
                    </td>
                    <td className="p-2 whitespace-nowrap">{row.platform}</td>
                    <td className="p-2 font-numeric whitespace-nowrap">{cell.monthLabel}</td>
                    <td className="p-2">{formatLifecycleLabel(cell.lifecycle ?? row.lifecycle)}</td>
                    <td className="p-2">{formatConfidenceLabel(cell.confidenceLevel)}</td>
                    <td className="p-2 font-numeric">{formatFactor(cell.baselineDailyAvg)}</td>
                    {useV41DetailColumns ? (
                      <>
                        <td className="p-2 font-mono text-xs">{cell.allCatV41Factors?.tier ?? '-'}</td>
                        <td className="p-2 font-numeric">{formatFactor(cell.allCatV41Factors?.d6)}</td>
                        <td className="p-2 font-numeric">{formatFactor(cell.allCatV41Factors?.trendRatio)}</td>
                        <td className="p-2 font-numeric">{formatFactor(cell.allCatV41Factors?.seasonalDaily)}</td>
                      </>
                    ) : (
                      <>
                        <td className="p-2 font-numeric">
                          {cell.horizonFactors ? formatPct(cell.horizonFactors.wNear) : '-'}
                        </td>
                        <td className="p-2 font-numeric">{formatFactor(cell.horizonFactors?.nearLevel)}</td>
                        <td className="p-2 font-numeric">{formatFactor(cell.horizonFactors?.structuralLevel)}</td>
                        <td className="p-2 font-numeric">{formatFactor(cell.horizonFactors?.growthFactor)}</td>
                        <td className="p-2 font-numeric">{formatFactor(cell.seasonalityFactor)}</td>
                        <td className="p-2 font-numeric">{formatFactor(cell.trendFactor)}</td>
                        <td
                          className={cn(
                            'p-2 font-numeric',
                            cell.categoryTrendWasClipped ? 'text-amber-700 dark:text-amber-300' : '',
                          )}
                        >
                          {formatFactor(cell.categoryCombinedFactor)}
                        </td>
                      </>
                    )}
                    <td className="p-2 font-numeric text-primary font-medium">
                      {formatFactor(cellEffective(cell))}
                    </td>
                    <td className="p-2 font-numeric text-text-sub">
                      {formatFactor(cell.forecastDailyAvg)}
                    </td>
                    <td
                      className={cn(
                        'p-2 font-numeric',
                        cell.manualDailyAvg != null ? 'text-amber-700 dark:text-amber-300' : 'text-text-sub',
                      )}
                    >
                      {cell.manualDailyAvg != null ? formatFactor(cell.manualDailyAvg) : '-'}
                    </td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>
      )}

      {horizon && horizon.total > 0 && (
        <ListPagination
          page={page}
          pageSize={pageSizeState}
          total={horizon.total}
          onPageChange={setPage}
          onPageSizeChange={(next) => {
            setPageSizeState(next);
            setPage(1);
          }}
        />
      )}
    </div>
  );
}
