import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  label: string;
  children: ReactNode;
  className?: string;
};

export function DataQueryField({ label, children, className }: Props) {
  return (
    <div className={cn('flex flex-col gap-1 text-sm', className)}>
      <span className="block text-text-sub">{label}</span>
      {children}
    </div>
  );
}
