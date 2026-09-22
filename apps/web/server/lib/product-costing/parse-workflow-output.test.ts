import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWorkflowLines } from './parse-workflow-output.js';

describe('parseWorkflowLines', () => {
  it('parses stringified lines', () => {
    const lines = parseWorkflowLines({
      lines: JSON.stringify([
        {
          category: '五金',
          material_name: '螺丝',
          unit: '个',
          qty_net: 10,
          confidence: 'high',
        },
      ]),
    });
    assert.equal(lines.length, 1);
    assert.equal(lines[0].materialName, '螺丝');
  });
});
