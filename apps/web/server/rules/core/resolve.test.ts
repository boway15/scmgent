import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ParamSchema } from './param.js';
import { resolveParams, type ActiveParamSet } from './resolve.js';

const schema = {
  coverDays: { kind: 'int', label: '覆盖天数', default: 30, min: 7, max: 180 },
  linkage: { kind: 'boolean', label: '联动', default: true },
} satisfies ParamSchema;

const sets: ActiveParamSet[] = [
  { id: 'g', scopeType: 'global', scopeValue: '*', params: { coverDays: 40 }, version: 2 },
  { id: 'pg', scopeType: 'project_group', scopeValue: 'G1', params: { linkage: false }, version: 1 },
  { id: 'wh', scopeType: 'warehouse', scopeValue: 'UK', params: { coverDays: 60 }, version: 1 },
  { id: 'bad', scopeType: 'warehouse', scopeValue: 'DE', params: { coverDays: 999, removed: 1 }, version: 1 },
];

describe('resolveParams', () => {
  it('falls back to defaults with no sets', () => {
    const r = resolveParams(schema, [], {});
    assert.deepEqual(r.values, { coverDays: 30, linkage: true });
    assert.deepEqual(r.sources, { coverDays: 'default', linkage: 'default' });
    assert.deepEqual(r.paramSetIds, []);
  });
  it('more specific scope wins, per key', () => {
    const r = resolveParams(schema, sets, { projectGroup: 'G1', warehouse: 'UK' });
    assert.deepEqual(r.values, { coverDays: 60, linkage: false });
    assert.deepEqual(r.sources.coverDays, { scopeType: 'warehouse', scopeValue: 'UK', paramSetId: 'wh' });
    assert.deepEqual(r.paramSetIds.sort(), ['g', 'pg', 'wh']);
  });
  it('ignores sets of other scope values', () => {
    const r = resolveParams(schema, sets, { projectGroup: 'G2', warehouse: 'US-WEST' });
    assert.deepEqual(r.values, { coverDays: 40, linkage: true });
  });
  it('skips invalid and unknown keys', () => {
    const r = resolveParams(schema, sets, { warehouse: 'DE' });
    assert.equal(r.values.coverDays, 40);
  });
});
