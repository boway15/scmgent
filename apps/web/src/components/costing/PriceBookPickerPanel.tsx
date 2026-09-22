import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type CostingPriceBookItem } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

function scopeLabel(
  item: CostingPriceBookItem,
  projectRegionId?: string | null,
  projectFactoryId?: string | null,
): string {
  if (
    projectRegionId &&
    projectFactoryId &&
    item.regionId === projectRegionId &&
    item.factoryId === projectFactoryId
  ) {
    return '当前工厂';
  }
  if (projectRegionId && item.regionId === projectRegionId && item.factoryId !== projectFactoryId) {
    return '区域通用';
  }
  return '全局通用';
}

type PriceBookPickerPanelProps = {
  category: string;
  defaultKeyword: string;
  projectRegionId?: string | null;
  projectFactoryId?: string | null;
  selecting?: boolean;
  onSelect: (item: CostingPriceBookItem) => void;
  className?: string;
};

export function PriceBookPickerPanel({
  category,
  defaultKeyword,
  projectRegionId,
  projectFactoryId,
  selecting = false,
  onSelect,
  className,
}: PriceBookPickerPanelProps) {
  const [keyword, setKeyword] = useState(defaultKeyword);
  const [debouncedKeyword, setDebouncedKeyword] = useState(defaultKeyword);

  useEffect(() => {
    setKeyword(defaultKeyword);
    setDebouncedKeyword(defaultKeyword);
  }, [defaultKeyword]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKeyword(keyword.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  const searchQuery = useQuery({
    queryKey: [
      'costing-price-book-bind',
      debouncedKeyword,
      category,
      projectRegionId,
      projectFactoryId,
    ],
    queryFn: () =>
      api.listCostingPriceBook({
        q: debouncedKeyword || undefined,
        category: category.trim() || undefined,
        activeOnly: true,
      }),
  });

  const items = searchQuery.data?.items ?? [];

  return (
    <div className={cn('rounded-md border border-border bg-card p-3 shadow-card', className)}>
      <p className="mb-2 text-xs text-text-sub">搜索成本库价目并选择</p>
      <Input
        className="h-8"
        value={keyword}
        placeholder="材料名称或规格"
        autoFocus
        disabled={selecting}
        onChange={(event) => setKeyword(event.target.value)}
      />
      <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border/60">
        {searchQuery.isLoading ? (
          <p className="p-3 text-sm text-text-hint">搜索中…</p>
        ) : items.length === 0 ? (
          <p className="p-3 text-sm text-text-hint">无匹配价目，可本单补价或到价目维护新增</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted/40',
                    selecting && 'pointer-events-none opacity-60',
                  )}
                  onClick={() => onSelect(item)}
                >
                  <span className="font-medium text-text-main">{item.materialName}</span>
                  <span className="text-xs text-text-sub">
                    {item.spec || '—'} · {item.unit} · ¥{Number(item.unitPrice).toFixed(4)}
                  </span>
                  <span className="text-xs text-text-hint">
                    {scopeLabel(item, projectRegionId, projectFactoryId)} · {item.category}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
