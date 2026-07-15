import type { ReactNode } from 'react';

type Props = {
  value: string;
  title?: string;
  className?: string;
  children?: ReactNode;
  /** 详情等场景完整换行展示，不截断 */
  wrap?: boolean;
};

/** 悬停展示完整内容的单元格（表格默认截断；wrap 时完整展示） */
export function InventoryOverviewCell({ value, title, className = '', children, wrap = false }: Props) {
  const display = children ?? value;
  const tip = title ?? (value && value !== '-' ? value : undefined);
  const isEmpty = value === '-' || value === '';

  if (wrap) {
    return (
      <span
        className={`block whitespace-normal break-words text-sm leading-relaxed ${isEmpty ? 'text-text-hint' : ''} ${className}`}
      >
        {display}
      </span>
    );
  }

  return (
    <span
      className={`group/cell relative block truncate ${isEmpty ? 'text-text-hint' : ''} ${className}`}
      title={tip}
    >
      {display}
      {tip && tip.length > 12 ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 hidden max-w-xs whitespace-normal break-words rounded-md border border-border bg-card px-2 py-1 text-xs text-text-main shadow-card group-hover/cell:block"
        >
          {tip}
        </span>
      ) : null}
    </span>
  );
}
