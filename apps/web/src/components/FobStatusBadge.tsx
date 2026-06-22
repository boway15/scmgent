import { cn } from '@/lib/utils';

export type FobBatchStatus = 'draft' | 'imported' | 'reviewed' | 'calculated' | 'confirmed';
export type FobExceptionStatus = 'pending' | 'confirmed' | 'rejected';

const BATCH_LABEL: Record<FobBatchStatus, string> = {
  draft: '草稿',
  imported: '已导入',
  reviewed: '已审核',
  calculated: '已核算',
  confirmed: '已确认',
};

const BATCH_STYLE: Record<FobBatchStatus, string> = {
  draft: 'bg-muted text-text-sub border-border',
  imported: 'bg-sky-50 text-sky-700 border-sky-200',
  reviewed: 'bg-violet-50 text-violet-700 border-violet-200',
  calculated: 'bg-amber-50 text-amber-800 border-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const EXCEPTION_LABEL: Record<FobExceptionStatus, string> = {
  pending: '待审核',
  confirmed: '已确认',
  rejected: '已驳回',
};

const EXCEPTION_STYLE: Record<FobExceptionStatus, string> = {
  pending: 'bg-amber-50 text-amber-800 border-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200',
};

function badgeClass(style: string) {
  return cn('inline-flex rounded border px-2 py-0.5 text-xs font-medium', style);
}

export function FobBatchStatusBadge({ status }: { status: string }) {
  const key = (status in BATCH_LABEL ? status : 'draft') as FobBatchStatus;
  return <span className={badgeClass(BATCH_STYLE[key])}>{BATCH_LABEL[key]}</span>;
}

export function FobExceptionStatusBadge({ status }: { status: string }) {
  const key = (status in EXCEPTION_LABEL ? status : 'pending') as FobExceptionStatus;
  return <span className={badgeClass(EXCEPTION_STYLE[key])}>{EXCEPTION_LABEL[key]}</span>;
}
