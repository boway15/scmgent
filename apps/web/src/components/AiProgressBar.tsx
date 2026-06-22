import { cn } from '@/lib/utils';

type AiProgressBarProps = {
  active?: boolean;
  className?: string;
};

export function AiProgressBar({ active = true, className }: AiProgressBarProps) {
  if (!active) return null;
  return <div className={cn('ai-progress-bar h-1 w-full overflow-hidden rounded-full', className)} />;
}
