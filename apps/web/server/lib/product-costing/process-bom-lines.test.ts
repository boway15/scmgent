import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyInferredProcessOverrides, drawerBottomGrooveMetersPerPiece } from './infer-process-overrides.js';
import {
  absorbProcessMisnamedBoardRows,
  isBevelProcessMisname,
  isGrooveProcessMisname,
} from './process-bom-lines.js';
import { parseBoardSpec } from './parse-board-spec.js';
import { sanitizeBomLines } from './sanitize-bom-lines.js';
import type { CostingBomLineDraft } from './types.js';

const line = (
  overrides: Partial<CostingBomLineDraft> & Pick<CostingBomLineDraft, 'materialName'>,
): CostingBomLineDraft => ({
  category: '板材',
  spec: '',
  unit: '块',
  qtyNet: 1,
  lossRate: 0.08,
  sourceRef: 'p4',
  confidence: 'high',
  origin: 'explicit',
  notes: '',
  ...overrides,
});

describe('process misname detection', () => {
  it('detects groove and bevel misnames', () => {
    assert.equal(isGrooveProcessMisname('抽屉底板开槽'), true);
    assert.equal(isGrooveProcessMisname('抽屉底板插槽开槽'), true);
    assert.equal(isGrooveProcessMisname('抽底'), false);
    assert.equal(isBevelProcessMisname('抽面上沿斜切'), true);
    assert.equal(isBevelProcessMisname('抽面'), false);
  });
});

describe('V7VJ-style misnames', () => {
  it('drops text-only groove/standard rows and keeps 抽面 shell for enrich', () => {
    const result = sanitizeBomLines([
      line({ materialName: '抽屉底板插槽开槽', spec: '抽屉面板下方开槽，插入5mm抽屉底板', unit: '项', qtyNet: 0 }),
      line({ materialName: '抽屉底板厚度标准', spec: '抽屉底板用5mm板', unit: '项', qtyNet: 0 }),
      line({
        materialName: '抽面',
        spec: '抽屉面板上沿整条做45°斜切倒角',
        qtyNet: 0,
        origin: 'explicit',
      }),
      line({ materialName: '抽底', spec: '5mm 527×251', qtyNet: 9, origin: 'template' }),
    ]);
    assert.equal(result.some((row) => /开槽|厚度标准/.test(row.materialName)), false);
    const front = result.find((row) => row.materialName === '抽面');
    assert.ok(front);
    assert.equal(parseBoardSpec(front?.spec ?? '').size, '');
    assert.match(front?.notes ?? '', /斜切/);
    const bottom = result.find((row) => row.materialName === '抽底');
    assert.match(bottom?.notes ?? '', /开槽/);
  });
});

describe('absorbProcessMisnamedBoardRows', () => {
  it('merges bevel row into 抽面 and drops duplicate groove row when 抽底 exists', () => {
    const result = absorbProcessMisnamedBoardRows([
      line({
        materialName: '抽面上沿斜切',
        spec: '12mm 529×251',
        unit: '项',
        qtyNet: 9,
        notes: '45度拉手',
        processOverrides: { grooveMeters: 3.15 },
      }),
      line({ materialName: '抽屉底板开槽', spec: '5mm 350×484', unit: '项', qtyNet: 9 }),
      line({ materialName: '抽底', spec: '5mm 350×484', qtyNet: 9 }),
      line({ materialName: '抽面', spec: '12mm 529×251', qtyNet: 9 }),
    ]);
    assert.equal(result.some((row) => row.materialName === '抽面上沿斜切'), false);
    assert.equal(result.some((row) => row.materialName === '抽屉底板开槽'), false);
    const front = result.find((row) => row.materialName === '抽面');
    assert.ok(front);
    assert.match(front?.spec ?? '', /529×251/);
    assert.equal(front?.qtyNet, 9);
    assert.match(front?.notes ?? '', /斜切/);
    assert.equal(front?.processOverrides?.grooveMeters, undefined);
    const bottom = result.find((row) => row.materialName === '抽底');
    assert.match(bottom?.notes ?? '', /开槽/);
  });

  it('converts lone groove row to 抽底 when no bottom exists', () => {
    const result = absorbProcessMisnamedBoardRows([
      line({ materialName: '抽屉底板开槽', spec: '5mm 350×484', qtyNet: 9 }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.materialName, '抽底');
  });
});

describe('sanitizeBomLines process absorption', () => {
  it('folds process misnames through sanitize pipeline', () => {
    const result = sanitizeBomLines([
      line({ materialName: '抽面上沿斜切', spec: '12mm 529×251', unit: '项', qtyNet: 9 }),
      line({ materialName: '抽屉底板开槽', spec: '5mm 350×484', unit: '项', qtyNet: 9 }),
      line({ materialName: '抽底', spec: '5mm 350×484', qtyNet: 9 }),
    ]);
    assert.equal(result.filter((row) => row.materialName === '抽面').length, 1);
    assert.equal(result.filter((row) => row.materialName === '抽底').length, 1);
    assert.equal(result.some((row) => /开槽|斜切/.test(row.materialName)), false);
  });
});

describe('applyInferredProcessOverrides', () => {
  it('sets groove meters on 抽侧/抽后 and extra cut on 抽面', () => {
    const result = applyInferredProcessOverrides(
      [
        line({ materialName: '抽面', spec: '12mm 529×251', qtyNet: 9 }),
        line({ materialName: '抽侧', spec: '12mm 350×191', qtyNet: 18 }),
        line({ materialName: '抽后', spec: '12mm 484×191', qtyNet: 9 }),
        line({ materialName: '抽底', spec: '5mm 350×484', qtyNet: 9 }),
      ],
      {
        designPrinciples: '抽面上沿45°斜切作拉手；抽屉底板开槽插入',
      },
    );
    assert.equal(drawerBottomGrooveMetersPerPiece('5mm 350×484'), 0.35);
    assert.equal(result.find((row) => row.materialName === '抽侧')?.processOverrides?.grooveMeters, 6.3);
    assert.equal(result.find((row) => row.materialName === '抽后')?.processOverrides?.grooveMeters, 3.15);
    assert.ok((result.find((row) => row.materialName === '抽面')?.processOverrides?.cutMeters ?? 0) > 10);
  });
});
