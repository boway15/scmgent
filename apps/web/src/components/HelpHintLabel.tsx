import type { ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  label: ReactNode;
  help: string;
  className?: string;
  tooltipClassName?: string;
};

/** 标签 + 悬停说明（用于区块标题或非表头场景） */
export function HelpHintLabel({ label, help, className, tooltipClassName }: Props) {
  return (
    <span className={cn('group/colhelp relative inline-flex max-w-full items-center gap-0.5', className)}>
      <span>{label}</span>
      <HelpCircle className="h-3.5 w-3.5 shrink-0 text-text-sub/70" aria-hidden />
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute top-full left-0 z-50 mt-1 hidden w-72 rounded-md border border-border bg-card px-2 py-1.5 text-left text-xs font-normal leading-relaxed text-text-main shadow-card group-hover/colhelp:block',
          tooltipClassName,
        )}
      >
        {help}
      </span>
    </span>
  );
}
