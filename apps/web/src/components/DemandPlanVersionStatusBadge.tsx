import {
  DEMAND_PLAN_STATUS_CLASS,
  DEMAND_PLAN_STATUS_LABEL,
} from '@/lib/demand-plan-utils';

type Props = {
  status: string;
  className?: string;
};

export function DemandPlanVersionStatusBadge({ status, className = '' }: Props) {
  const label = DEMAND_PLAN_STATUS_LABEL[status] ?? status;
  const tone = DEMAND_PLAN_STATUS_CLASS[status] ?? DEMAND_PLAN_STATUS_CLASS.archived;
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone} ${className}`}
    >
      {label}
    </span>
  );
}
