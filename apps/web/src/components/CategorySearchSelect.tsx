import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ChecklistSearchSelect } from '@/components/ChecklistSearchSelect';
import { placeFixedPopover } from '@/components/costing/place-fixed-popover';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const PANEL_MIN_WIDTH = 320;

type CategorySearchSelectProps = {
  placeholder?: string;
  className?: string;
  /** sales=销量历史页权限；forecast=销售预测页权限 */
  scope?: 'sales' | 'forecast';
} & (
  | {
      multiple?: false;
      value: string;
      onChange: (value: string) => void;
    }
  | {
      multiple: true;
      value: string[];
      onChange: (value: string[]) => void;
    }
);

function useCategoryOptions(scope: 'sales' | 'forecast', search: string, open: boolean) {
  const [debouncedSearch, setDebouncedSearch] = useState(search);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data: options = [], isFetching } = useQuery({
    queryKey: ['sku-categories-search', scope, debouncedSearch, open],
    queryFn: () =>
      scope === 'forecast'
        ? api.getSalesForecastCategories(debouncedSearch || undefined, 50)
        : api.searchSalesHistoryCategories(debouncedSearch || undefined, 50),
    enabled: open,
    staleTime: 30_000,
  });

  return { options, isFetching, debouncedSearch };
}

function CategoryMultiSearchSelect({
  value,
  onChange,
  placeholder = '搜索品类…',
  className,
  scope = 'sales',
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
  scope?: 'sales' | 'forecast';
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { options, isFetching } = useCategoryOptions(scope, search, open);

  return (
    <ChecklistSearchSelect
      value={value}
      onChange={onChange}
      options={options}
      isFetching={isFetching}
      search={search}
      onSearchChange={setSearch}
      open={open}
      onOpenChange={setOpen}
      placeholder={placeholder}
      allLabel="全部品类"
      clearAriaLabel="清除品类"
      emptyHint="输入关键词或粘贴品类路径"
      noMatchHint="无匹配品类"
      className={className}
      selectedDisplay="summary"
      maxSelection={50}
    />
  );
}

function CategorySingleSearchSelect({
  value,
  onChange,
  placeholder = '搜索品类…',
  className,
  scope = 'sales',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  scope?: 'sales' | 'forecast';
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const { options, isFetching, debouncedSearch } = useCategoryOptions(scope, search, open);

  const placePanel = () => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, PANEL_MIN_WIDTH), window.innerWidth - 16);
    const pos = placeFixedPopover({
      trigger: rect,
      panelWidth: width,
      panelHeight: 384,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPanelStyle({ ...pos, width });
  };

  useEffect(() => {
    setSearch(value);
  }, [value]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placePanel();
    const onMove = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && listRef.current?.contains(target)) return;
      placePanel();
    };
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  const pick = (next: string) => {
    onChange(next);
    setSearch(next);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setSearch('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('relative min-w-56 w-96 max-w-full', className)}>
      <div ref={anchorRef}>
      <Input
        className="h-9 pr-8"
        placeholder={placeholder}
        value={search}
        title={search || undefined}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => {
          setOpen(true);
          placePanel();
        }}
        onChange={(e) => {
          const next = e.target.value;
          setSearch(next);
          onChange(next);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false);
            setSearch(value);
          }
        }}
      />
      </div>
      {search ? (
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-hint hover:text-text-sub"
          onClick={clear}
          aria-label="清除品类"
        >
          ×
        </button>
      ) : null}
      {open && panelStyle
        ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              style={{ top: panelStyle.top, left: panelStyle.left, width: panelStyle.width }}
              className="fixed z-[80] max-h-96 overflow-auto rounded-md border border-border bg-card py-1 text-sm shadow-md"
            >
          <li>
            <button
              type="button"
              role="option"
              className="block w-full px-3 py-2 text-left hover:bg-muted/60"
              onMouseDown={(e) => e.preventDefault()}
              onClick={clear}
            >
              全部品类
            </button>
          </li>
          {isFetching ? (
            <li className="px-3 py-2 text-text-hint">搜索中…</li>
          ) : options.length ? (
            options.map((item) => (
              <li key={item}>
                <button
                  type="button"
                  role="option"
                  aria-selected={item === value}
                  title={item}
                  className={cn(
                    'block w-full whitespace-normal break-words px-3 py-2 text-left leading-5 hover:bg-muted/60',
                    item === value && 'bg-primary/10 text-primary',
                  )}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(item)}
                >
                  {item}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-text-hint">
              {debouncedSearch.trim()
                ? '无匹配品类；可直接粘贴列表中的完整路径后点「筛选」'
                : '输入关键词或粘贴品类路径'}
            </li>
          )}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}

export function CategorySearchSelect(props: CategorySearchSelectProps) {
  if (props.multiple) {
    return (
      <CategoryMultiSearchSelect
        value={props.value}
        onChange={props.onChange}
        placeholder={props.placeholder}
        className={props.className}
        scope={props.scope}
      />
    );
  }
  return (
    <CategorySingleSearchSelect
      value={props.value}
      onChange={props.onChange}
      placeholder={props.placeholder}
      className={props.className}
      scope={props.scope}
    />
  );
}
