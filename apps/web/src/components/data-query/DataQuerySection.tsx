import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type Props = {
  title?: string;
  description?: ReactNode;
  headerExtra?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** 独立「查询条件」卡片，用于列表/看板类数据分析页。 */
export function DataQuerySection({
  title = '查询条件',
  description,
  headerExtra,
  children,
  className,
}: Props) {
  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description ? <div className="text-sm text-text-sub">{description}</div> : null}
          </div>
          {headerExtra}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}
