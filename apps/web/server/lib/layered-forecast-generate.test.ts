import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildLayeredNodesFromAggregates,
  type LayeredNodeDraft,
} from './layered-forecast-generate.js';

const START_MONTH = '2026-07';
const HORIZON = 2;

function buildNodes(
  monthlyEntries: Array<[string, number]> = [
    ['sku-a\tAMAZON\t2026-05', 20],
    ['sku-a\tAMAZON\t2026-06', 30],
    ['sku-b\tTIKTOK\t2026-05', 10],
    ['sku-b\tTIKTOK\t2026-06', 20],
  ],
): LayeredNodeDraft[] {
  return buildLayeredNodesFromAggregates({
    startMonth: START_MONTH,
    horizonMonths: HORIZON,
    skus: [
      { id: 'sku-a', projectGroup: '项目一组', category: '家具/椅子' },
      { id: 'sku-b', projectGroup: '项目一组', category: '家具/椅子' },
      { id: 'sku-c', projectGroup: '项目一组', category: '家具/椅子' },
    ],
    monthlyBySkuPlatform: new Map(monthlyEntries),
    recent90BySkuPlatform: new Map([
      ['sku-a\tAMAZON', 90],
      ['sku-b\tTIKTOK', 45],
      ['sku-c\tAMAZON', 30],
    ]),
  });
}

function qty(nodes: LayeredNodeDraft[]): number {
  return nodes.reduce((sum, node) => sum + node.qty, 0);
}

describe('buildLayeredNodesFromAggregates', () => {
  it('reconciles SKU quantities to their platform quantity', () => {
    const nodes = buildNodes();
    const platform = nodes.find(
      (node) =>
        node.level === 'platform' &&
        node.projectGroup === '项目一组' &&
        node.category === '椅子' &&
        node.platform === 'AMAZON' &&
        node.period === START_MONTH,
    );
    const skuNodes = nodes.filter(
      (node) =>
        node.level === 'sku' &&
        node.projectGroup === '项目一组' &&
        node.category === '椅子' &&
        node.platform === 'AMAZON' &&
        node.period === START_MONTH,
    );

    assert.ok(platform);
    assert.equal(qty(skuNodes), platform.qty);
  });

  it('scales platform totals to the category total', () => {
    const nodes = buildNodes();
    const category = nodes.find(
      (node) =>
        node.level === 'category' &&
        node.projectGroup === '项目一组' &&
        node.category === '椅子' &&
        node.period === START_MONTH,
    );
    const platforms = nodes.filter(
      (node) =>
        node.level === 'platform' &&
        node.projectGroup === '项目一组' &&
        node.category === '椅子' &&
        node.period === START_MONTH,
    );

    assert.ok(category);
    assert.equal(qty(platforms), category.qty);
  });

  it('ignores history at or after startMonth', () => {
    const withoutFutureHistory = buildNodes();
    const withFutureHistory = buildNodes([
      ['sku-a\tAMAZON\t2026-05', 20],
      ['sku-a\tAMAZON\t2026-06', 30],
      ['sku-a\tAMAZON\t2026-07', 9_999],
      ['sku-b\tTIKTOK\t2026-05', 10],
      ['sku-b\tTIKTOK\t2026-06', 20],
      ['sku-b\tTIKTOK\t2026-08', 9_999],
    ]);

    assert.deepEqual(withFutureHistory, withoutFutureHistory);
  });

  it('creates all horizon nodes when history is empty', () => {
    const nodes = buildNodes([]);

    assert.ok(nodes.length > 0);
    assert.deepEqual(
      Array.from(new Set(nodes.map((node) => node.period))),
      ['2026-07', '2026-08'],
    );
    assert.ok(nodes.every((node) => node.qty === 0));
  });
});
