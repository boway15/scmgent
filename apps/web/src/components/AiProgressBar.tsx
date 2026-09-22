import { cn } from '@/lib/utils';

type AiProgressBarProps = {
  active?: boolean;
  /** 0–100；传入时为 determinate 进度条 */
  percent?: number;
  className?: string;
};

export function AiProgressBar({ active = true, percent, className }: AiProgressBarProps) {
  if (!active) return null;

  if (typeof percent === 'number') {
    const clamped = Math.min(100, Math.max(0, percent));
    return (
      <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-black/5', className)}>
        <div
          className="ai-progress-bar h-full rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    );
  }

  return <div className={cn('ai-progress-bar h-1 w-full overflow-hidden rounded-full', className)} />;
}
