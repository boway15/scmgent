import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type ListSearchBarProps = {
  keyword: string;
  onKeywordChange: (value: string) => void;
  onSearch: () => void;
  placeholder?: string;
  children?: ReactNode;
};

export function ListSearchBar({
  keyword,
  onKeywordChange,
  onSearch,
  placeholder = '输入关键词查询',
  children,
}: ListSearchBarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <Input
        className="h-9 w-64"
        placeholder={placeholder}
        value={keyword}
        onChange={(e) => onKeywordChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onSearch();
          }
        }}
        aria-label="列表搜索"
      />
      <Button size="sm" variant="outline" onClick={onSearch}>
        查询
      </Button>
      {children}
    </div>
  );
}
