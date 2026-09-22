import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sanitizeBomLines } from './sanitize-bom-lines.js';
import type { CostingBomLineDraft } from './types.js';

const line = (overrides: Partial<CostingBomLineDraft> & Pick<CostingBomLineDraft, 'materialName'>): CostingBomLineDraft => ({
  category: '板材',
  spec: '',
  unit: '块',
  qtyNet: 1,
  lossRate: 0.08,
  sourceRef: 'p5',
  confidence: 'high',
  origin: 'explicit',
  notes: '',
  ...overrides,
});

describe('sanitizeBomLines', () => {
  it('drops overall-size, cover-gap, and department footer rows', () => {
    const result = sanitizeBomLines([
      line({
        category: '其他',
        materialName: '产品尺寸',
        spec: '1200×400×785 mm',
        unit: '套',
      }),
      line({ materialName: '抽屉盖住', spec: '10mm', unit: '米' }),
      line({ category: '其他', materialName: '傲杰大件事业部', spec: '', unit: '套', qtyNet: 1 }),
      line({ category: '其他', materialName: '十七部', spec: '', unit: '套', qtyNet: 0 }),
      line({ materialName: '桌面板', spec: '15mm', unit: '张' }),
    ]);
    assert.deepEqual(
      result.map((row) => row.materialName),
      ['桌面板'],
    );
  });

  it('folds profile height annotations into base row and drops annotation rows', () => {
    const result = sanitizeBomLines([
      line({ materialName: '踢脚线', spec: '-', unit: '块', qtyNet: 1 }),
      line({ materialName: '踢脚线高度', spec: '60mm', unit: '项', qtyNet: 0 }),
      line({ materialName: '正面拉条', spec: '-', unit: '块', qtyNet: 1 }),
      line({ materialName: '正面拉条高度', spec: '40mm', unit: '项', qtyNet: 0 }),
    ]);
    assert.equal(result.some((row) => row.materialName === '踢脚线高度'), false);
    assert.equal(result.some((row) => row.materialName === '正面拉条高度'), false);
    assert.equal(result.find((row) => row.materialName === '踢脚线')?.spec, '60mm');
    assert.equal(result.find((row) => row.materialName === '前拉条')?.spec, '40mm');
  });

  it('drops cmf placeholder and process standard rows', () => {
    const result = sanitizeBomLines([
      line({ materialName: '菱形内嵌板', spec: '', qtyNet: 0, notes: 'CMF记录' }),
      line({ category: '表面工艺', materialName: '油漆', spec: '边缘喷黑漆', unit: '项', qtyNet: 0 }),
      line({ category: '表面工艺', materialName: '喷黑漆', spec: '外露边', unit: '升', qtyNet: 0.0001 }),
    ]);
    assert.equal(result.some((row) => row.materialName === '菱形内嵌板'), false);
    assert.equal(result.some((row) => row.materialName === '油漆'), false);
    assert.equal(result.some((row) => row.materialName === '喷黑漆'), true);
  });

  it('zeros tiny quantities and height-only profile lengths', () => {
    const result = sanitizeBomLines([
      line({ materialName: '背板', qtyNet: 0.0002 }),
      line({ materialName: '踢脚线', spec: '60mm', unit: '米', qtyNet: 1 }),
      line({ materialName: '正面拉条', spec: '40mm', unit: '米', qtyNet: 1 }),
    ]);
    assert.equal(result.find((row) => row.materialName === '背板')?.qtyNet, 0);
    assert.equal(result.find((row) => row.materialName === '踢脚线')?.qtyNet, 0);
    assert.equal(result.find((row) => row.materialName === '前拉条')?.qtyNet, 0);
    assert.equal(result.find((row) => row.materialName === '前拉条')?.category, '板材');
    assert.match(result.find((row) => row.materialName === '踢脚线')?.notes ?? '', /截面/);
  });

  it('rewrites board meter units to sheets and drops empty substrate rows', () => {
    const result = sanitizeBomLines([
      line({ materialName: '桌面板', spec: '15mm', unit: '米', qtyNet: 1 }),
      line({ materialName: '密度板', spec: '', unit: '张', qtyNet: 0 }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.materialName, '桌面板');
    assert.equal(result[0]?.unit, '张');
  });

  it('drops unsized decorative finish rows that are not cut materials', () => {
    const result = sanitizeBomLines([
      line({ materialName: '胡桃色板', spec: '9mm', unit: '张', qtyNet: 0 }),
      line({ materialName: '浮雕黑色板', spec: '5mm', unit: '张', qtyNet: 0 }),
      line({ materialName: '胡桃色板', spec: '9mm', unit: '张', qtyNet: 0 }),
      line({ materialName: '密度板', spec: '15mm', unit: '张', qtyNet: 0.01 }),
      line({ materialName: '抽面', spec: '12mm 598×210', unit: '块', qtyNet: 6 }),
    ]);
    assert.deepEqual(
      result.map((row) => row.materialName),
      ['抽面'],
    );
  });

  it('merges drawer slide aliases to one row', () => {
    const result = sanitizeBomLines([
      line({
        category: '五金',
        materialName: '滚珠滑轨',
        spec: '12寸',
        unit: '套',
        qtyNet: 18,
        sourceRef: 'p4',
      }),
      line({
        category: '五金',
        materialName: '抽屉滑轨',
        spec: '12寸',
        unit: '套',
        qtyNet: 18,
        sourceRef: 'p4',
      }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.materialName, '抽屉滑轨');
    assert.equal(result[0]?.qtyNet, 18);
  });

  it('merges anti-tip hardware aliases ignoring 套/个', () => {
    const result = sanitizeBomLines([
      line({
        category: '五金',
        materialName: '金属防倾倒装置',
        spec: '未标明',
        unit: '套',
        qtyNet: 1,
        confidence: 'medium',
      }),
      line({
        category: '其他',
        materialName: '金属防倾倒装置',
        spec: '',
        unit: '个',
        qtyNet: 1,
        confidence: 'high',
        sourceRef: 'p5',
      }),
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0]?.materialName, '防倾倒配件');
    assert.equal(result[0]?.unit, '套');
    assert.equal(result[0]?.category, '五金');
  });

  it('drops notes-page standard placeholders and promotes slide spec rows', () => {
    const result = sanitizeBomLines([
      line({
        materialName: '设计规则-箱体板厚',
        spec: '除特别说明外板材厚度 9mm，背板 3mm',
        unit: '张',
        qtyNet: 0,
      }),
      line({
        materialName: '抽屉底板厚度标准',
        spec: '抽屉底板用5mm板',
        unit: '项',
        qtyNet: 0,
      }),
      line({
        materialName: '抽屉结构标准',
        spec: '9mm胡桃+5mm浮雕',
        unit: '项',
        qtyNet: 0,
      }),
      line({
        category: '五金',
        materialName: '抽屉滑轨规格标准',
        spec: '2节12寸滚珠滑轨',
        unit: '套',
        qtyNet: 0,
      }),
      line({ materialName: '侧板', spec: '12mm 400×785', qtyNet: 2 }),
    ]);
    assert.equal(result.some((row) => /标准/.test(row.materialName)), false);
    assert.equal(result.find((row) => row.materialName === '抽屉滑轨')?.spec, '2节12寸滚珠滑轨');
  });

  it('absorbs explosion 颗粒板 cuts into the same-size named parts', () => {
    const result = sanitizeBomLines([
      line({ materialName: '抽面', spec: '12mm 521×210', unit: '块', qtyNet: 9 }),
      line({ materialName: '抽后', spec: '12mm 476×150', unit: '块', qtyNet: 9 }),
      line({ materialName: '背拉条', spec: '12mm 1576×50', unit: '根', qtyNet: 1 }),
      line({ materialName: '颗粒板', spec: '12mm 521×210', unit: '块', qtyNet: 9 }),
      line({ materialName: '颗粒板', spec: '12mm 1576×50', unit: '根', qtyNet: 4 }),
      line({ materialName: '颗粒板', spec: '12mm 476×150', unit: '块', qtyNet: 9 }),
      line({ materialName: '颗粒板', spec: '3mm 1576×50', unit: '根', qtyNet: 2 }),
    ]);
    assert.equal(result.filter((row) => row.materialName === '颗粒板').length, 1);
    assert.equal(result.find((row) => row.materialName === '颗粒板')?.spec, '3mm 1576×50');
    assert.equal(result.filter((row) => row.materialName === '抽面').length, 1);
    assert.equal(result.filter((row) => row.materialName === '抽后').length, 1);
  });

  it('swaps substrate name and part leftover in spec', () => {
    const result = sanitizeBomLines([
      line({ materialName: '密度板', spec: '15mm 桌面板', unit: '张', qtyNet: 1 }),
      line({ materialName: '顶底板', spec: '15mm 1200×400', unit: '块', qtyNet: 2 }),
    ]);
    assert.equal(result.some((row) => row.materialName === '密度板'), false);
    const desk = result.find((row) => row.materialName === '桌面板');
    assert.equal(desk?.spec, '15mm');
    assert.equal(desk?.substrate, '密度板');
    assert.equal(result.find((row) => row.materialName === '顶底板')?.spec, '15mm 1200×400');
  });
});
