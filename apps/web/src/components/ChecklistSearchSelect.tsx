import { useEffect, useId, useRef, useState } from 'react';
import { placeFixedPopover } from '@/components/costing/place-fixed-popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

function BreakablePath({ text }: { text: string }) {
  const parts = text.split(/([/\-])/);
  return parts.map((part, index) =>
    part === '/' || part === '-' ? (
      <span key={index}>
        {part}
        <wbr />
      </span>
    ) : (
      <span key={index}>{part}</span>
    ),
  );
}

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
  /** summary：仅输入框展示已选数量，不在表单区展开 Tag（适合工具栏） */
  selectedDisplay?: 'tags' | 'summary';
  /** 全选时最多保留项数（与后端 scope 上限对齐时可传 50） */
  maxSelection?: number;
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
  selectedDisplay = 'tags',
  maxSelection,
}: ChecklistSearchSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const [capHint, setCapHint] = useState(false);
  const capHintTimerRef = useRef<number | null>(null);
  const selected = new Set(value);
  const optionSet = new Set(options);
  const pinned = value.filter((item) => !optionSet.has(item));
  const rows = [...pinned, ...options];

  const placePanel = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = rect.width;
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

  useEffect(
    () => () => {
      if (capHintTimerRef.current != null) {
        window.clearTimeout(capHintTimerRef.current);
      }
    },
    [],
  );

  const flashCapHint = () => {
    setCapHint(true);
    if (capHintTimerRef.current != null) {
      window.clearTimeout(capHintTimerRef.current);
    }
    capHintTimerRef.current = window.setTimeout(() => {
      setCapHint(false);
      capHintTimerRef.current = null;
    }, 3000);
  };

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
    if (selected.has(item)) {
      onChange(value.filter((current) => current !== item));
      return;
    }
    if (maxSelection && value.length >= maxSelection) {
      flashCapHint();
      return;
    }
    onChange([...value, item]);
  };

  const clear = () => {
    onChange([]);
    onSearchChange('');
    setCapHint(false);
    if (capHintTimerRef.current != null) {
      window.clearTimeout(capHintTimerRef.current);
      capHintTimerRef.current = null;
    }
  };

  const selectAllVisible = () => {
    if (!rows.length) return;
    const merged = [...new Set([...value, ...rows])];
    if (maxSelection && merged.length > maxSelection) {
      flashCapHint();
    }
    onChange(maxSelection ? merged.slice(0, maxSelection) : merged);
  };

  const showTagsBelow = selectedDisplay === 'tags' && value.length > 0;
  const summaryMode = selectedDisplay === 'summary';

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
      {summaryMode && capHint && maxSelection ? (
        <p className="absolute left-0 top-full z-20 mt-0.5 whitespace-nowrap text-xs text-primary">
          已达上限 {maxSelection} 个
        </p>
      ) : null}
      {showTagsBelow ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {value.map((item) => (
            <span
              key={item}
              title={item}
              className="inline-flex max-w-full items-start gap-1 rounded-md bg-primary/10 px-2 py-1 text-xs leading-5 text-primary"
            >
              <span className="min-w-0 whitespace-normal break-words text-left">
                <BreakablePath text={item} />
              </span>
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
          className="fixed z-50 max-h-80 overflow-auto overflow-x-hidden rounded-md border border-border bg-card py-1 text-sm shadow-md"
        >
          {summaryMode ? (
            <li className="sticky top-0 z-10 flex gap-2 border-b border-border/60 bg-card px-3 py-2">
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!rows.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={selectAllVisible}
              >
                全选
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!value.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={clear}
              >
                清空
              </button>
            </li>
          ) : (
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
          )}
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
                    <span className="min-w-0 flex-1 whitespace-normal break-words leading-5">
                      <BreakablePath text={item} />
                    </span>
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
