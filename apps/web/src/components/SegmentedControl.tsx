import { cn } from '@/lib/utils';

type SegmentedOption<T extends string> = {
  id: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  label?: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (id: T) => void;
  'aria-label'?: string;
};

/** 互斥选项：一组边框内的分段，避免和页面主按钮抢同一套实心橙。 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  return (
    <div className="inline-flex items-center gap-2">
      {label ? <span className="shrink-0 text-xs text-text-sub">{label}</span> : null}
      <div
        role="group"
        aria-label={ariaLabel ?? label}
        className="inline-flex rounded-md border border-border bg-card p-0.5"
      >
        {options.map((option) => {
          const selected = option.id === value;
          return (
            <button
              key={option.id}
              type="button"
              aria-pressed={selected}
              className={cn(
                'h-8 rounded px-3 text-sm transition-colors',
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'text-text-sub hover:bg-muted hover:text-text-main',
              )}
              onClick={() => onChange(option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
