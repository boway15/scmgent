import { Link } from 'react-router-dom';

type Props = {
  variant?: 'banner' | 'compact';
};

/** 合计视图下导出/导入校准须先切分平台 */
export function CalibrationImportByChannelHint({ variant = 'banner' }: Props) {
  const where =
    variant === 'compact' ? '页内筛选区' : '下方筛选区';
  const body = (
    <>
      要给运营做 Excel 确认并<strong>导入校准</strong>时，请先将{where}「平台展示」切换为<strong>分平台</strong>，再点「导出校准表」或「导出明细」。
      <Link to="/help#forecast-review" className="ml-1 text-primary underline-offset-2 hover:underline">
        帮助说明
      </Link>
    </>
  );

  return (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
      {body}
    </p>
  );
}
