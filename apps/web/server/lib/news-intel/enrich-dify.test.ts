import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnrichOutput } from './enrich-dify.js';

describe('parseEnrichOutput', () => {
  it('parses chinese summary without requiring titleZh', () => {
    const result = parseEnrichOutput(
      {
        summary: '美国站家具运费调整',
        topic_category: '物流海关与关税',
        departments: ['物流', '平台运营'],
        relevance_score: 80,
        priority: 'high',
      },
      'other',
      'medium',
    );
    assert.ok(result);
    assert.equal(result?.summary, '美国站家具运费调整');
    assert.equal(result?.topicCategory, '物流海关与关税');
    assert.deepEqual(result?.departments, ['物流', '平台运营']);
  });

  it('requires titleZh when translating english official content', () => {
    const result = parseEnrichOutput(
      {
        summary: '美国贸易代表办公室发布关税措施',
        relevance_score: 90,
      },
      'other',
      'high',
      { requireTitleZh: true },
    );
    assert.equal(result, null);
  });

  it('accepts titleZh for english translation output', () => {
    const result = parseEnrichOutput(
      {
        title_zh: '美国发布家具进口关税措施',
        summary: '官方公告涉及关税与清关。',
        relevance_score: 88,
        priority: 'high',
      },
      'other',
      'medium',
      { requireTitleZh: true },
    );
    assert.ok(result);
    assert.equal(result?.titleZh, '美国发布家具进口关税措施');
  });

  it('returns null when summary missing', () => {
    const result = parseEnrichOutput({ title_zh: '仅有标题' }, 'other', 'low');
    assert.equal(result, null);
  });
});
