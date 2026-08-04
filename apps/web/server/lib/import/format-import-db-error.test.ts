import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatImportDbError } from './format-import-db-error.js';

describe('formatImportDbError', () => {
  it('maps duplicate skus.code to actionable SKU message', () => {
    const message = formatImportDbError({
      code: '23505',
      constraint: 'skus_code_key',
      detail: 'Key (code)=(DJ502313_34) already exists.',
    });
    assert.match(message, /重复 SKU 编码/);
    assert.match(message, /DJ502313_34/);
  });

  it('maps duplicate sales_history rows to daily table message', () => {
    const message = formatImportDbError({
      code: '23505',
      constraint: 'sales_history_sku_date_channel_unique_idx',
      detail: 'Key (sku_id, sale_date, channel)=(...) already exists.',
    });
    assert.match(message, /销量日表存在重复记录/);
  });

  it('preserves variant_no length guidance for 22001', () => {
    const message = formatImportDbError({
      code: '22001',
      message: 'value too long for type character varying(2) variant_no',
    });
    assert.match(message, /变参号超出长度限制/);
  });
});
