import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  children: ReactNode;
  className?: string;
};

/** 数据分析区统一的筛选控件条（灰底描边、表单项底对齐）。 */
export function DataQueryToolbar({ children, className }: Props) {
  return (
    <div
      className={cn(
        'relative z-30 flex flex-wrap items-end gap-x-3 gap-y-3 overflow-visible rounded-md border border-border/80 bg-muted/20 p-3',
        className,
      )}
    >
      {children}
    </div>
  );
}
