import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type CategorySearchSelectProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  /** sales=销量历史页权限；forecast=销售预测页权限 */
  scope?: 'sales' | 'forecast';
};

export function CategorySearchSelect({
  value,
  onChange,
  placeholder = '搜索品类…',
  className,
  scope = 'sales',
}: CategorySearchSelectProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(value);
  const [debouncedSearch, setDebouncedSearch] = useState(value);

  useEffect(() => {
    setSearch(value);
  }, [value]);

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

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const pick = (next: string) => {
    onChange(next);
    setSearch(next);
    setDebouncedSearch(next);
    setOpen(false);
  };

  const clear = () => {
    onChange('');
    setSearch('');
    setDebouncedSearch('');
    setOpen(false);
  };

  return (
    <div ref={rootRef} className={cn('relative min-w-56 w-96 max-w-full', className)}>
      <Input
        className="h-9 pr-8"
        placeholder={placeholder}
        value={search}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => setOpen(true)}
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
            setDebouncedSearch(value);
          }
        }}
      />
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
      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-border bg-card py-1 text-sm shadow-md"
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
                    'block w-full px-3 py-2 text-left hover:bg-muted/60 truncate',
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
        </ul>
      ) : null}
    </div>
  );
}
