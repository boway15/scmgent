import assert from 'node:assert/strict';
import { isDifyKeyConfigured } from './dify.js';
import {
  mergeEnhancedReason,
  parseAlertWorkflowMessage,
  parseEnhancedReplenishmentJson,
} from './dify-workflows.js';

const originalKnowledge = process.env.DIFY_API_KEY_KNOWLEDGE;

function testKeyConfig() {
  process.env.DIFY_API_KEY_KNOWLEDGE = '';
  assert.equal(isDifyKeyConfigured('DIFY_API_KEY_KNOWLEDGE'), false);

  process.env.DIFY_API_KEY_KNOWLEDGE = 'app-xxxx';
  assert.equal(isDifyKeyConfigured('DIFY_API_KEY_KNOWLEDGE'), false);

  process.env.DIFY_API_KEY_KNOWLEDGE = 'app-real-key-from-dify';
  assert.equal(isDifyKeyConfigured('DIFY_API_KEY_KNOWLEDGE'), true);
}

function testParseEnhancedJson() {
  const rows = parseEnhancedReplenishmentJson(
    JSON.stringify([
      {
        skuCode: 'SKU-001',
        warehouseCode: 'US-WEST',
        reason: '建议补货：有效供给低于 ROP',
        summary: '优先处理',
        risk_notes: '交期 30 天',
      },
    ]),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].skuCode, 'SKU-001');
  assert.match(mergeEnhancedReason(rows[0], 'fallback'), /建议补货/);
  assert.match(mergeEnhancedReason(rows[0], 'fallback'), /风险提示/);
}

function testParseAlertMessage() {
  assert.equal(
    parseAlertWorkflowMessage({ feishu_message: '今日 3 条预警，请优先处理缺货 SKU。' }),
    '今日 3 条预警，请优先处理缺货 SKU。',
  );
  assert.equal(parseAlertWorkflowMessage({ summary: '简要通报' }), '简要通报');
  assert.equal(parseAlertWorkflowMessage({}), null);
}

testKeyConfig();
testParseEnhancedJson();
testParseAlertMessage();

if (originalKnowledge === undefined) {
  delete process.env.DIFY_API_KEY_KNOWLEDGE;
} else {
  process.env.DIFY_API_KEY_KNOWLEDGE = originalKnowledge;
}

console.log('dify.test.ts: all passed');
