import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultsOf, validateParamPatch, type ParamSchema } from './param.js';

const schema = {
  coverDays: { kind: 'int', label: '覆盖天数', unit: '天', default: 30, min: 7, max: 180 },
  ratio: { kind: 'number', label: '倍数', default: 1.1, min: 1, max: 3 },
  linkage: { kind: 'boolean', label: '联动', default: true },
  priority: {
    kind: 'enum',
    label: '优先级',
    default: 'a',
    options: [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ],
  },
} satisfies ParamSchema;

describe('defaultsOf', () => {
  it('returns default for every key', () => {
    assert.deepEqual(defaultsOf(schema), { coverDays: 30, ratio: 1.1, linkage: true, priority: 'a' });
  });
});

describe('validateParamPatch', () => {
  it('accepts a sparse valid patch', () => {
    const r = validateParamPatch(schema, { coverDays: 45, linkage: false });
    assert.deepEqual(r, { ok: true, value: { coverDays: 45, linkage: false } });
  });
  it('rejects unknown key, non-integer, out of range, wrong enum', () => {
    const r = validateParamPatch(schema, { foo: 1, coverDays: 7.5, ratio: 9, priority: 'z' });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.errors.length, 4);
    }
  });
  it('rejects non-object', () => {
    assert.equal(validateParamPatch(schema, null).ok, false);
    assert.equal(validateParamPatch(schema, [1]).ok, false);
  });
});
