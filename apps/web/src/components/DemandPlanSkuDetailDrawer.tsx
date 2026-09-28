import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { DemandPlanWeeklyForecastTable } from '@/components/DemandPlanWeeklyForecastTable';
import { HelpHintLabel } from '@/components/HelpHintLabel';
import { DEMAND_PLAN_WEEKLY_FORECAST_SECTION_HELP } from '@/lib/demand-plan-column-help';
import { formatLifecycleLabel } from '@/lib/forecast-labels';
import { cn } from '@/lib/utils';

export type DemandPlanSkuClickInput = {
  skuId: string;
  skuCode: string;
};

type Props = {
  versionId: string;
  selectedSku: DemandPlanSkuClickInput | null;
  onClose: () => void;
};

const formatWeeklyDaily = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(4);
};

export function DemandPlanSkuDetailDrawer({ versionId, selectedSku, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const detailQuery = useQuery({
    queryKey: ['demand-plan-sku-detail', versionId, selectedSku?.skuId],
    queryFn: () => api.getDemandPlanSkuDetail(versionId, selectedSku!.skuId),
    enabled: Boolean(versionId && selectedSku?.skuId),
  });

  const detail = detailQuery.data;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (selectedSku) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [selectedSku]);

  return (
    <dialog
      ref={dialogRef}
      className="m-0 ml-auto h-full max-h-full w-full max-w-5xl border-l border-border bg-card p-0 shadow-card backdrop:bg-black/30"
      onClose={onClose}
    >
      {selectedSku && (
        <div className="flex h-full flex-col">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-sm text-text-sub">{selectedSku.skuCode}</p>
              <h2 className="whitespace-normal break-words text-lg font-semibold leading-snug text-text-main">
                {detail?.sku.name || '—'}
              </h2>
              {detail?.sku ? (
                <p className="mt-1 text-sm text-text-sub">
                  {detail.sku.category || '—'}
                  {detail.sku.productCategory ? ` · ${detail.sku.productCategory}` : ''}
                  {' · '}
                  {formatLifecycleLabel(detail.sku.lifecycle)}
                </p>
              ) : null}
            </div>
            <Button size="sm" variant="outline" onClick={onClose}>
              关闭
            </Button>
          </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4 pb-10">
            {detailQuery.isLoading ? (
              <p className="text-sm text-text-sub">加载中…</p>
            ) : detailQuery.isError ? (
              <p className="text-sm text-destructive">
                {detailQuery.error instanceof Error ? detailQuery.error.message : '加载失败'}
              </p>
            ) : detail ? (
              <>
                {detail.sku && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium text-text-main">商品信息</h3>
                    <div className="space-y-1 rounded-md border border-border bg-muted/30 p-3 text-sm">
                      <p>
                        单位 {detail.sku.unit || '—'}
                        {detail.sku.salesCountry ? ` · 销售国家 ${detail.sku.salesCountry}` : ''}
                        {detail.sku.leadTimeDays != null ? ` · 交期 ${detail.sku.leadTimeDays} 天` : ''}
                        {detail.sku.moq != null ? ` · MOQ ${detail.sku.moq}` : ''}
                      </p>
                      {(detail.sku.ownerName || detail.sku.developerName) && (
                        <p className="text-text-sub">
                          {detail.sku.ownerName ? `负责人 ${detail.sku.ownerName}` : ''}
                          {detail.sku.ownerName && detail.sku.developerName ? ' · ' : ''}
                          {detail.sku.developerName ? `开发 ${detail.sku.developerName}` : ''}
                        </p>
                      )}
                    </div>
                  </section>
                )}

                {detail.forecastWeeks.length > 0 ? (
                  <DemandPlanWeeklyForecastTable
                    forecastVersion={detail.forecastVersion}
                    forecastHorizon={detail.forecastHorizon}
                    forecastContext={detail.forecastContext}
                    weekRows={detail.forecastWeeks}
                    productCategory={detail.sku.productCategory}
                  />
                ) : (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium text-text-main">
                      <HelpHintLabel
                        label="未来 6 月预测 · 周维度"
                        help={DEMAND_PLAN_WEEKLY_FORECAST_SECTION_HELP}
                      />
                    </h3>
                    <p className="text-sm text-text-sub">暂无已发布销量预测或计划周次。</p>
                  </section>
                )}

                <section className="space-y-2">
                  <h3 className="text-sm font-medium text-text-main">近 26 周实际日均</h3>
                  <p className="text-xs text-text-sub">
                    按 ISO 周汇总销量，折算为周日均；当前周按已发生天数计算（进行中）。
                  </p>
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-text-sub">
                          <th className="p-2 font-normal">周次</th>
                          <th className="p-2 font-normal">周销量</th>
                          <th className="p-2 font-normal">实际日均</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.historyWeeks.map((row) => (
                          <tr key={row.weekKey} className="border-b border-border/60">
                            <td className="p-2 font-mono">{row.weekKey}</td>
                            <td className="p-2 font-numeric">{row.qtySold.toLocaleString()}</td>
                            <td
                              className={cn(
                                'p-2 font-numeric',
                                row.actualDailyAvg != null && row.actualDailyAvg > 0
                                  ? 'text-primary'
                                  : 'text-text-sub',
                              )}
                            >
                              {formatWeeklyDaily(row.actualDailyAvg)}
                              {row.inProgress ? (
                                <span className="ml-1 text-[10px] text-text-sub">进行中</span>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      )}
    </dialog>
  );
}
