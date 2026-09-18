import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { latestRulePatchForBillItem, pendingCountFromRulePatches } from './fob-batch-helpers.js';
import type { FeeRuleRow } from './fob-fee-rules.js';

/** 与 nextFobBatchNo 内序号解析逻辑一致 */
function parseMaxSeq(prefix: string, batchNos: string[]): number {
  let maxSeq = 0;
  for (const batchNo of batchNos) {
    const tail = batchNo.slice(prefix.length);
    const n = parseInt(tail.replace(/\D/g, ''), 10);
    if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
  }
  return maxSeq;
}

describe('nextFobBatchNo sequence', () => {
  const prefix = 'FOB-202606';

  it('uses max existing suffix + 1 when middle batch was deleted', () => {
    const existing = [`${prefix}0001`, `${prefix}0003`];
    assert.equal(parseMaxSeq(prefix, existing) + 1, 4);
  });

  it('parses dashed legacy batch numbers', () => {
    const existing = [`${prefix}-001`, `${prefix}0002`];
    assert.equal(parseMaxSeq(prefix, existing) + 1, 3);
  });
});

describe('latestRulePatchForBillItem', () => {
  const rules: FeeRuleRow[] = [
    {
      feeType: '报关费',
      sourceBillType: 'trucking',
      allocationMethod: 'by_ticket',
      defaultStage: 'customs',
      priority: 10,
    },
    {
      feeType: '压夜费',
      sourceBillType: 'trucking',
      allocationMethod: 'manual',
      defaultStage: 'other',
      priority: 10,
    },
  ];

  it('uses latest global rules for unmatched rows', () => {
    const patch = latestRulePatchForBillItem(
      rules,
      {
        feeType: '报关费',
        amountCny: 200,
        remark: null,
        assignedMerchantCode: null,
        isException: false,
        exceptionStatus: null,
      },
      'trucking',
    );
    assert.equal(patch.allocationMethod, 'by_ticket');
    assert.equal(patch.isException, false);
    assert.equal(patch.exceptionStatus, null);
  });

  it('refreshes pending exception flags from latest rules', () => {
    const patch = latestRulePatchForBillItem(
      rules,
      {
        feeType: '茶水费',
        amountCny: 50,
        remark: null,
        assignedMerchantCode: null,
        isException: false,
        exceptionStatus: null,
      },
      'trucking',
    );
    assert.equal(patch.allocationMethod, 'by_volume');
    assert.equal(patch.isException, true);
    assert.equal(patch.exceptionStatus, 'pending');
  });

  it('updates method from latest rules but keeps confirmed review lock', () => {
    const patch = latestRulePatchForBillItem(
      rules,
      {
        feeType: '报关费',
        amountCny: 200,
        remark: null,
        assignedMerchantCode: '工厂A',
        isException: false,
        exceptionStatus: 'confirmed',
      },
      'trucking',
    );
    assert.equal(patch.allocationMethod, 'by_ticket');
    assert.equal(patch.isException, false);
    assert.equal(patch.exceptionStatus, 'confirmed');
    assert.equal(patch.assignedMerchantCode, '工厂A');
  });

  it('updates method from latest rules but keeps rejected review lock', () => {
    const patch = latestRulePatchForBillItem(
      rules,
      {
        feeType: '压夜费',
        amountCny: 80,
        remark: null,
        assignedMerchantCode: null,
        isException: true,
        exceptionStatus: 'rejected',
      },
      'trucking',
    );
    assert.equal(patch.allocationMethod, 'manual');
    assert.equal(patch.isException, true);
    assert.equal(patch.exceptionStatus, 'rejected');
  });

  it('counts pending after latest-rule preview so calculate can refuse persist', () => {
    const patches = [
      latestRulePatchForBillItem(
        rules,
        {
          feeType: '茶水费',
          amountCny: 50,
          remark: null,
          assignedMerchantCode: null,
          isException: false,
          exceptionStatus: null,
        },
        'trucking',
      ),
      latestRulePatchForBillItem(
        rules,
        {
          feeType: '报关费',
          amountCny: 200,
          remark: null,
          assignedMerchantCode: null,
          isException: false,
          exceptionStatus: null,
        },
        'trucking',
      ),
    ];
    assert.equal(pendingCountFromRulePatches(patches), 1);
  });
});

