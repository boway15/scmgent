import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { ChecklistSearchSelect } from '@/components/ChecklistSearchSelect';

type ProjectGroupSearchSelectProps = {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  className?: string;
};

export function ProjectGroupSearchSelect({
  value,
  onChange,
  placeholder = '搜索项目组…',
  className,
}: ProjectGroupSearchSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const { data: options = [], isFetching } = useQuery({
    queryKey: ['sku-project-groups-search', debouncedSearch, open],
    queryFn: () => api.getSalesForecastProjectGroups(debouncedSearch || undefined, 50),
    enabled: open,
    staleTime: 30_000,
  });

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
      allLabel="全部项目组"
      clearAriaLabel="清除项目组"
      emptyHint="输入关键词搜索项目组"
      noMatchHint="无匹配项目组"
      className={className}
    />
  );
}
