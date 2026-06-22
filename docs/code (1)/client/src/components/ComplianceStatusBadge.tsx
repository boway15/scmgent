import { cn } from '@/lib/utils';

export type ComplianceStatus = 'complete' | 'partial' | 'missing';

const LABEL: Record<ComplianceStatus, string> = {
  complete: '完整',
  partial: '部分缺失',
  missing: '未维护',
};

const STYLE: Record<ComplianceStatus, string> = {
  complete: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  partial: 'bg-amber-50 text-amber-800 border-amber-200',
  missing: 'bg-muted text-text-hint border-border',
};

export function ComplianceStatusBadge({ status }: { status: ComplianceStatus }) {
  return (
    <span
      className={cn(
        'inline-flex rounded border px-2 py-0.5 text-xs font-medium',
        STYLE[status],
      )}
    >
      {LABEL[status]}
    </span>
  );
}
