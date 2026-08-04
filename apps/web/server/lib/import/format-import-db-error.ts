type PgError = {
  code?: string;
  message?: string;
  detail?: string;
  constraint?: string;
  table?: string;
};

export function formatImportDbError(err: unknown): string {
  const pg = err as PgError;
  const detail = pg.detail?.trim();
  const constraint = pg.constraint?.trim();
  const hint = detail || constraint || pg.message?.trim() || '';

  if (pg.code === '22001') {
    const msg = pg.message ?? '';
    if (msg.includes('variant_no') || msg.includes('character varying(2)')) {
      return '变参号超出长度限制（legacy 编码如 DJ502313_342 变参可为 3 位）。请执行数据库迁移后重试，或检查 sku_code';
    }
    return `字段值超出数据库长度限制：${msg || '请检查 SKU 编码、变参号、供应商编码等列'}`;
  }
  if (pg.code === '22021' || (pg.message && pg.message.includes('0x00'))) {
    return 'CSV 含非法空字节（NUL），请重新导出或联系数据方修复；服务端已尝试自动清洗，若仍失败请换一份文件';
  }
  if (pg.code === '23505') {
    if (constraint?.includes('sales_history') || hint.includes('sales_history')) {
      return `销量日表存在重复记录${hint ? `（${hint}）` : ''}。同一 SKU+日期+平台仅保留一条；若重复导入请忽略或清理历史重复数据后重试`;
    }
    if (
      constraint?.includes('skus') ||
      hint.includes('skus') ||
      hint.includes('(code)=')
    ) {
      return `存在重复 SKU 编码${hint ? `（${hint}）` : ''}。请检查 CSV 中 SKU 列是否有重复行，或 legacy/9 位码混用导致同一 SKU 多种写法`;
    }
    return `存在重复数据（唯一约束冲突）${hint ? `：${hint}` : '，请检查 sku_code 是否重复'}`;
  }
  if (pg.message) return pg.message;
  return err instanceof Error ? err.message : 'Import failed';
}
