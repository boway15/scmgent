import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInventoryDataIssueExportCsv } from './inventory-data-issue-list.js';

test('buildInventoryDataIssueExportCsv maps labels and erp hints', () => {
  const { headers, bodyRows } = buildInventoryDataIssueExportCsv([
    {
      id: '1',
      fingerprint: 'fp',
      skuId: 'sku-1',
      skuCode: 'A001',
      skuName: '测试 SKU',
      warehouseCode: 'US-WEST',
      issueType: 'unallocated_warehouse',
      impactModule: 'horizon',
      example: '海外在库 10 无占比',
      qty: 10,
      status: 'open',
      ownerId: null,
      resolutionNote: null,
      lastSeenAt: new Date('2026-09-29T01:00:00.000Z'),
      createdAt: new Date('2026-09-28T01:00:00.000Z'),
      updatedAt: new Date('2026-09-29T01:00:00.000Z'),
    },
  ]);
  assert.equal(headers[0], '问题类型');
  assert.equal(bodyRows[0]?.[0], '未分仓');
  assert.equal(bodyRows[0]?.[7], '待跟进');
  assert.match(String(bodyRows[0]?.[8]), /迅捷/);
});
