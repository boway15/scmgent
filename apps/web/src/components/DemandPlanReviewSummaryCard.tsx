import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DEMAND_PLAN_SKIP_REASON_LABEL } from '@/lib/demand-plan-utils';

type Props = {
  versionId: string;
  onOpenT99?: () => void;
  onOpenAccuracy?: () => void;
};

export function DemandPlanReviewSummaryCard({ versionId, onOpenT99, onOpenAccuracy }: Props) {
  const summaryQuery = useQuery({
    queryKey: ['demand-plan-review-summary', versionId],
    queryFn: () => api.getDemandPlanReviewSummary(versionId),
    enabled: Boolean(versionId),
  });

  const summary = summaryQuery.data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">发布复核摘要</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {summaryQuery.isLoading ? (
          <p className="text-text-sub">加载中…</p>
        ) : summaryQuery.isError ? (
          <p className="text-destructive">
            {summaryQuery.error instanceof Error ? summaryQuery.error.message : '加载失败'}
          </p>
        ) : summary ? (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-text-sub">
              <span>
                计划 SKU{' '}
                <span className="font-numeric text-text-main">{summary.skuTotal.toLocaleString()}</span>
              </span>
              <span>
                计划行{' '}
                <span className="font-numeric text-text-main">{summary.rowTotal.toLocaleString()}</span>
              </span>
              <span>
                已校准单元格{' '}
                <span className="font-numeric text-text-main">
                  {summary.calibratedCellCount.toLocaleString()}
                </span>
              </span>
              <span>
                待校准 T99{' '}
                <span className="font-numeric text-text-main">{summary.pendingT99SkuCount}</span>
              </span>
              <span>
                无 Champion{' '}
                <span className="font-numeric text-text-main">{summary.skuWithoutChampionCount}</span>
              </span>
            </div>
            {Object.keys(summary.skippedByReason).length > 0 ? (
              <p className="text-xs text-text-sub">
                生成跳过：
                {Object.entries(summary.skippedByReason)
                  .map(
                    ([reason, count]) =>
                      `${DEMAND_PLAN_SKIP_REASON_LABEL[reason] ?? reason} ${count}`,
                  )
                  .join(' · ')}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {onOpenT99 ? (
                <Button size="sm" variant="outline" onClick={onOpenT99}>
                  打开数据明细（可用待校准筛选）
                </Button>
              ) : null}
              {onOpenAccuracy ? (
                <Button size="sm" variant="outline" onClick={onOpenAccuracy}>
                  准确度复盘
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
