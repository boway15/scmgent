import { useEffect, useId, useRef, useState } from 'react';
import { placeFixedPopover } from '@/components/costing/place-fixed-popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type ChecklistSearchSelectProps = {
  value: string[];
  onChange: (value: string[]) => void;
  options: string[];
  isFetching: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  placeholder?: string;
  allLabel: string;
  clearAriaLabel: string;
  emptyHint: string;
  noMatchHint: string;
  className?: string;
};

export function ChecklistSearchSelect({
  value,
  onChange,
  options,
  isFetching,
  search,
  onSearchChange,
  open,
  onOpenChange,
  placeholder = '搜索…',
  allLabel,
  clearAriaLabel,
  emptyHint,
  noMatchHint,
  className,
}: ChecklistSearchSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const selected = new Set(value);
  const optionSet = new Set(options);
  const pinned = value.filter((item) => !optionSet.has(item));
  const rows = [...pinned, ...options];

  const placePanel = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.max(rect.width, 360);
    const pos = placeFixedPopover({
      trigger: rect,
      panelWidth: width,
      panelHeight: 320,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPanelStyle({ ...pos, width });
  };

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        onOpenChange(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    placePanel();
    const onMove = (event: Event) => {
      if (listRef.current?.contains(event.target as Node)) return;
      placePanel();
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  const toggle = (item: string) => {
    onChange(selected.has(item) ? value.filter((current) => current !== item) : [...value, item]);
  };

  const clear = () => {
    onChange([]);
    onSearchChange('');
  };

  return (
    <div ref={rootRef} className={cn('relative w-full', open && 'z-30', className)}>
      <div ref={anchorRef}>
      <Input
        className="h-9 pr-8"
        placeholder={value.length ? `已选 ${value.length} 个，继续搜索…` : placeholder}
        value={search}
        title={value.length ? value.join('、') : undefined}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => {
          onOpenChange(true);
          placePanel();
        }}
        onChange={(e) => {
          onSearchChange(e.target.value);
          onOpenChange(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onOpenChange(false);
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const keyword = search.trim();
          const exact = rows.find((item) => item === keyword);
          const target = exact ?? (options.length === 1 ? options[0] : undefined);
          if (target) toggle(target);
        }}
      />
      </div>
      {value.length || search ? (
        <button
          type="button"
          className="absolute right-2 top-[1.125rem] -translate-y-1/2 text-xs text-text-hint hover:text-text-sub"
          onClick={clear}
          aria-label={clearAriaLabel}
        >
          ×
        </button>
      ) : null}
      {value.length ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {value.map((item) => (
            <span
              key={item}
              title={item}
              className="inline-flex max-w-full items-start gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs leading-5 text-primary"
            >
              <span className="min-w-0 whitespace-normal break-all text-left">{item}</span>
              <button
                type="button"
                className="shrink-0 leading-5"
                aria-label={`移除 ${item}`}
                onClick={() => toggle(item)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-multiselectable="true"
          style={
            panelStyle
              ? { top: panelStyle.top, left: panelStyle.left, width: panelStyle.width }
              : undefined
          }
          className="fixed z-50 max-h-80 overflow-auto rounded-md border border-border bg-card py-1 text-sm shadow-md"
        >
          <li>
            <button
              type="button"
              role="option"
              className="block w-full px-3 py-2 text-left hover:bg-muted/60"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
            >
              {allLabel}
            </button>
          </li>
          {isFetching && !rows.length ? (
            <li className="px-3 py-2 text-text-hint">搜索中…</li>
          ) : rows.length ? (
            rows.map((item) => {
              const checked = selected.has(item);
              return (
                <li key={item}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={checked}
                    title={item}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/60',
                      checked && 'bg-primary/10 text-primary',
                    )}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(item)}
                  >
                    <span
                      className={cn(
                        'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none',
                        checked
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-card text-transparent',
                      )}
                      aria-hidden
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1 whitespace-normal break-all leading-5">{item}</span>
                  </button>
                </li>
              );
            })
          ) : (
            <li className="px-3 py-2 text-text-hint">
              {search.trim() ? noMatchHint : emptyHint}
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
