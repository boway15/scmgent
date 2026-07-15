import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSalesXiaoshouPreviewResponse,
  detectXiaoshouWideKind,
  importXiaoshouSalesHistory,
  shouldRunSalesXiaoshouImportAsync,
} from './sales-xiaoshou.js';

describe('sales-xiaoshou import', () => {
  it('detects daily and monthly sku wide formats', () => {
    assert.equal(
      detectXiaoshouWideKind([
        { SKU: 'A', '(2026-06-01)': '3', '(2026-06-02)': '1' },
      ]),
      'daily',
    );
    assert.equal(
      detectXiaoshouWideKind([
        { SKU: 'A', '(2026-05)': '100', '(2026-04)': '80' },
      ]),
      'monthly_sku',
    );
    assert.equal(detectXiaoshouWideKind([{ sku_code: 'A', sale_date: '2026-01-01' }]), null);
  });

  it('builds preview diagnostics for daily wide rows', () => {
    const preview = buildSalesXiaoshouPreviewResponse({
      dailyWideRows: [
        {
          SKU: 'DJ1',
          平台: '亚马逊',
          站点: 'Amazon美国',
          '(2026-06-01)': '5',
        },
      ],
    });
    assert.equal(preview.hasBlockingIssues, false);
    assert.equal(preview.salesDiagnostics.daily?.skuCount, 1);
    assert.equal(preview.salesDiagnostics.daily?.expandedRowCount, 1);
  });

  it('blocks monthly sku wide upload in preview', () => {
    const preview = buildSalesXiaoshouPreviewResponse({
      dailyWideRows: [{ SKU: 'A', '(2026-05)': '100' }],
    });
    assert.equal(preview.hasBlockingIssues, true);
    assert.match(preview.validationIssues[0]?.message ?? '', /不再支持/);
  });

  it('rejects empty upload', async () => {
    const result = await importXiaoshouSalesHistory({});
    assert.equal(result.imported, 0);
    assert.match(result.errors[0], /请上传日销量/);
  });

  it('rejects monthly sku wide import', async () => {
    const result = await importXiaoshouSalesHistory({
      dailyWideRows: [{ SKU: 'A', '(2026-05)': '100' }],
    });
    assert.equal(result.imported, 0);
    assert.match(result.errors[0], /不再支持/);
  });

  it('uses async when expanded row estimate exceeds threshold', () => {
    const dateHeaders = Object.fromEntries(
      Array.from({ length: 600 }, (_, index) => {
        const month = Math.floor(index / 28) + 1;
        const day = (index % 28) + 1;
        return [`(2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')})`, '1'];
      }),
    );
    const input = {
      dailyWideRows: [{ SKU: 'A', ...dateHeaders }],
    };
    assert.equal(shouldRunSalesXiaoshouImportAsync(input), true);
    const preview = buildSalesXiaoshouPreviewResponse(input, { lightweight: true });
    assert.equal(preview.salesDiagnostics.daily?.expandedRowCount, 600);
  });

  it('stays sync for tiny daily wide uploads', () => {
    const input = {
      dailyWideRows: [{ SKU: 'A', '(2026-06-01)': '1' }],
    };
    assert.equal(shouldRunSalesXiaoshouImportAsync(input), false);
  });
});
