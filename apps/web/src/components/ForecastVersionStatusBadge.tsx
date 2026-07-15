type Props = {
  status: string;
  className?: string;
};

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200',
  published: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  archived: 'border-border bg-muted text-text-sub',
};

export function ForecastVersionStatusBadge({ status, className = '' }: Props) {
  const label = STATUS_LABEL[status] ?? status;
  const tone = STATUS_CLASS[status] ?? STATUS_CLASS.archived;
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone} ${className}`}
    >
      {label}
    </span>
  );
}
