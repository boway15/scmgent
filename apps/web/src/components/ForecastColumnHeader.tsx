import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  help: string;
  className?: string;
};

/** 预测明细表头：标签 + 悬停说明 */
export function ForecastColumnHeader({ label, help, className }: Props) {
  return (
    <th className={cn('p-2 font-normal', className)}>
      <span
        className="group/colhelp relative inline-flex max-w-full items-center gap-0.5"
      >
        <span>{label}</span>
        <HelpCircle
          className="h-3 w-3 shrink-0 text-text-sub/70"
          aria-hidden
        />
        <span
          role="tooltip"
          className="pointer-events-none absolute top-full left-0 z-50 mt-1 hidden w-56 rounded-md border border-border bg-card px-2 py-1.5 text-left text-xs font-normal leading-relaxed text-text-main shadow-card group-hover/colhelp:block"
        >
          {help}
        </span>
      </span>
    </th>
  );
}
