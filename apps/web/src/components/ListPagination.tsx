import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;

type ListPaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
};

export function ListPagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: ListPaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const [jumpValue, setJumpValue] = useState(String(page));

  useEffect(() => {
    setJumpValue(String(page));
  }, [page]);

  const jumpToPage = () => {
    const parsed = Number(jumpValue);
    if (!Number.isFinite(parsed)) {
      setJumpValue(String(page));
      return;
    }
    const next = Math.min(totalPages, Math.max(1, Math.trunc(parsed)));
    setJumpValue(String(next));
    if (next !== page) onPageChange(next);
  };

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
      <span className="text-sm text-text-sub">
        共 {total} 条 · 第 {page} / {totalPages} 页
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSizeChange && (
          <select
            className="h-8 rounded-md border border-border bg-card px-2 text-sm text-text-main"
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            aria-label="每页条数"
          >
            {PAGE_SIZE_OPTIONS.map((size) => (
              <option key={size} value={size}>
                每页 {size} 条
              </option>
            ))}
          </select>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          上一页
        </Button>
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-text-sub">跳至</span>
          <Input
            type="number"
            min={1}
            max={totalPages}
            className="h-8 w-16 px-2 text-center font-numeric text-sm"
            value={jumpValue}
            disabled={total === 0}
            onChange={(e) => setJumpValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                jumpToPage();
              }
            }}
            aria-label="跳转页码"
          />
          <span className="text-sm text-text-sub">页</span>
          <Button size="sm" variant="outline" disabled={total === 0} onClick={jumpToPage}>
            跳转
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={page >= totalPages || total === 0}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          下一页
        </Button>
      </div>
    </div>
  );
}
