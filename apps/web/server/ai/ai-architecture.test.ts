import assert from 'node:assert/strict';
import { getAiConfigSummary } from './config.js';
import { queryKnowledgeWithFallback } from './providers/index.js';

function testAiConfig() {
  const cfg = getAiConfigSummary();
  assert.equal(typeof cfg.difyEnabled, 'boolean');
  assert.equal(typeof cfg.replenishmentWorkflow, 'boolean');
  assert.equal(typeof cfg.alertWorkflow, 'boolean');
}

async function testLocalFallbackProvider() {
  const original = process.env.DIFY_API_KEY_KNOWLEDGE;
  process.env.DIFY_API_KEY_KNOWLEDGE = '';
  const { result, provider, fallback } = await queryKnowledgeWithFallback({
    query: '安全库存如何计算',
    userId: '00000000-0000-0000-0000-000000000001',
  });
  assert.equal(provider, 'local');
  assert.equal(fallback, false);
  assert.match(result.answer, /安全库存/);
  if (original === undefined) {
    delete process.env.DIFY_API_KEY_KNOWLEDGE;
  } else {
    process.env.DIFY_API_KEY_KNOWLEDGE = original;
  }
}

testAiConfig();
await testLocalFallbackProvider();
console.log('ai-architecture tests passed');
