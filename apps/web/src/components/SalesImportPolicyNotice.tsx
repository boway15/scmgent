import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

type Props = {
  className?: string;
  compact?: boolean;
};

export function SalesImportPolicyNotice({ className, compact }: Props) {
  const { data: policy } = useQuery({
    queryKey: ['sales-import-policy'],
    queryFn: () => api.getSalesImportPolicy(),
    staleTime: 60_000,
  });

  if (!policy) return null;

  const isIncremental = policy.mode === 'incremental';
  const cutoff = policy.importMinSaleDate ?? policy.recommendedIncrementalDate;

  if (compact) {
    return (
      <p className={cn('text-sm text-text-sub', className)}>
        当前导入模式：
        <strong className="text-text-main">{isIncremental ? '日常增量' : '全量初始化'}</strong>
        {isIncremental ? (
          <>
            {' '}
            — 仅处理宽表中 <strong className="text-text-main">{cutoff}</strong> 及之后的日期列；该日之前历史已在月表保留，不再重复导入。
          </>
        ) : (
          <>
            {' '}
            — 展开宽表全部日期列写入日表并聚合月表；全量完成后请配置环境变量{' '}
            <code className="text-xs">SALES_IMPORT_MIN_DATE={policy.recommendedIncrementalDate}</code>{' '}
            切换为日常增量。
          </>
        )}
      </p>
    );
  }

  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3 text-sm leading-relaxed',
        isIncremental
          ? 'border-emerald-200 bg-emerald-50 text-emerald-950'
          : 'border-amber-200 bg-amber-50 text-amber-950',
        className,
      )}
    >
      <p className="font-medium">
        导入策略（{isIncremental ? '日常增量模式' : '全量初始化模式 · 当前测试/首次上线前'}）
      </p>
      <ul className="mt-2 list-disc space-y-1.5 pl-5">
        <li>
          <strong>只需上传一份「产品销售报表-每日」宽表</strong>；系统写入日销量 → 聚合月销量 → 日表仅保留近{' '}
          {policy.dailyRetentionDays} 天明细（更早月份在<strong>月销量</strong> Tab 查询）。
        </li>
        {isIncremental ? (
          <>
            <li>
              已启用增量分界日 <code className="text-xs">{cutoff}</code>：本次及后续人工导入<strong>只展开该日及之后的日期列</strong>，
              <strong>不会</strong>再处理 {cutoff} 之前的数据（历史已在首次初始化时写入月表）。
            </li>
            <li>请继续上传同一份每日宽表 CSV，新日期列会自动追加；已存在行跳过。</li>
          </>
        ) : (
          <>
            <li>
              <strong>首次初始化</strong>：处理宽表中<strong>全部历史日期列</strong>（含 {cutoff} 之前），用于一次性灌入历史销量。
            </li>
            <li>
              <strong>初始化完成后（正式上线）</strong>：在服务器配置{' '}
              <code className="text-xs">SALES_IMPORT_MIN_DATE={policy.recommendedIncrementalDate}</code>{' '}
              并重新发布；之后改为<strong>人工定期导入</strong>，仅处理 {policy.recommendedIncrementalDate}{' '}
              及之后数据，{policy.recommendedIncrementalDate} 之前不再重复导入。
            </li>
          </>
        )}
      </ul>
    </div>
  );
}
