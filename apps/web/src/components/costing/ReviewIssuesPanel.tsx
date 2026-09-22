import { useState } from 'react';
import type { CostingReviewIssue } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type ReviewIssuesPanelProps = {
  issues: CostingReviewIssue[];
  readOnly: boolean;
  onJumpToLine: (lineId: string) => void;
  onMarkReviewed: (lineId: string) => void;
  pendingLineId?: string | null;
};

const CODE_LABELS: Record<CostingReviewIssue['code'], string> = {
  missing_price: '缺价',
  missing_qty: '缺用量',
  missing_thickness: '缺板厚',
  unmatched: '未匹配',
  template_pending: '模板待核',
  low_confidence: '低置信',
  inferred_cut: '规则开料',
};

export function ReviewIssuesPanel({
  issues,
  readOnly,
  onJumpToLine,
  onMarkReviewed,
  pendingLineId,
}: ReviewIssuesPanelProps) {
  const [warnsExpanded, setWarnsExpanded] = useState(false);
  const blocks = issues.filter((item) => item.severity === 'block');
  const warns = issues.filter((item) => item.severity === 'warn');

  if (!issues.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>异常审核</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-text-hint">暂无待审核项，可直接计算成本。</p>
        </CardContent>
      </Card>
    );
  }

  const renderIssue = (issue: CostingReviewIssue) => (
    <li
      key={`${issue.lineId ?? issue.materialName}-${issue.code}`}
      className={cn(
        'flex flex-wrap items-start justify-between gap-2 rounded-md border px-3 py-2 text-sm',
        issue.severity === 'block'
          ? 'border-destructive/40 bg-destructive/5'
          : 'border-warning/40 bg-highlight-warm/40',
      )}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-main">
          {issue.materialName}
          <span className="ml-2 text-xs font-normal text-text-sub">
            {CODE_LABELS[issue.code]}
          </span>
        </p>
        <p className="mt-0.5 text-text-sub">{issue.message}</p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        {issue.lineId ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onJumpToLine(issue.lineId!)}>
            去核对
          </Button>
        ) : null}
        {!readOnly && issue.lineId && issue.severity === 'warn' ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pendingLineId === issue.lineId}
            onClick={() => onMarkReviewed(issue.lineId!)}
          >
            {pendingLineId === issue.lineId ? '保存中…' : '已核对'}
          </Button>
        ) : null}
      </div>
    </li>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>异常审核</CardTitle>
        <p className="text-sm text-text-hint">
          阻断项须补全后才能计算；提醒项请核对后点「已核对」或修改物料行。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {blocks.length ? (
          <section>
            <h3 className="mb-2 text-sm font-semibold text-destructive">阻断（{blocks.length}）</h3>
            <ul className="space-y-2">{blocks.map(renderIssue)}</ul>
          </section>
        ) : null}
        {warns.length ? (
          <section>
            <button
              type="button"
              className="mb-2 flex w-full items-center gap-2 text-left text-sm font-semibold text-text-main hover:text-primary"
              aria-expanded={warnsExpanded}
              onClick={() => setWarnsExpanded((value) => !value)}
            >
              <span
                className={cn(
                  'inline-block text-xs text-text-hint transition-transform',
                  warnsExpanded && 'rotate-90',
                )}
                aria-hidden
              >
                ▶
              </span>
              提醒（{warns.length}）
              <span className="font-normal text-text-hint">
                {warnsExpanded ? '点击收起' : '点击展开'}
              </span>
            </button>
            {warnsExpanded ? <ul className="space-y-2">{warns.map(renderIssue)}</ul> : null}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
