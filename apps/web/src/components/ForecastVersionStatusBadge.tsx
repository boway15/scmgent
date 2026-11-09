type Props = {
  status: string;
  pipelineStatus?: string | null;
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

const PIPELINE_LABEL: Record<string, string> = {
  generating: '生成写入中',
  landing: '影子落地中',
  ready: '已就绪',
  failed: '生成失败',
};

const PIPELINE_CLASS: Record<string, string> = {
  generating: 'border-sky-500/30 bg-sky-500/10 text-sky-800 dark:text-sky-200',
  landing: 'border-violet-500/30 bg-violet-500/10 text-violet-800 dark:text-violet-200',
  ready: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200',
  failed: 'border-red-500/30 bg-red-500/10 text-red-800 dark:text-red-200',
};

export function isForecastPipelineBusy(pipelineStatus?: string | null): boolean {
  return pipelineStatus === 'generating' || pipelineStatus === 'landing';
}

export function ForecastVersionStatusBadge({ status, pipelineStatus, className = '' }: Props) {
  const label = STATUS_LABEL[status] ?? status;
  const tone = STATUS_CLASS[status] ?? STATUS_CLASS.archived;
  const showPipeline =
    status === 'draft' && Boolean(pipelineStatus && PIPELINE_LABEL[pipelineStatus]);
  const pipelineHint =
    pipelineStatus === 'ready'
      ? '生成与影子落地已完成，数字可核对'
      : '全量生成会先写 V4.1，再自动跑影子落地；此阶段刷新页面数字可能变化';

  return (
    <span className={`inline-flex flex-wrap items-center gap-1 ${className}`}>
      <span
        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${tone}`}
      >
        {label}
      </span>
      {showPipeline ? (
        <span
          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${PIPELINE_CLASS[pipelineStatus!] ?? PIPELINE_CLASS.generating}`}
          title={pipelineHint}
        >
          {PIPELINE_LABEL[pipelineStatus!]}
        </span>
      ) : null}
    </span>
  );
}
