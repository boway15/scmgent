import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  orderRecommendYes,
  parseRecommendYesNoQuery,
  shipRecommendYes,
} from './alert-recommendation-filter.js';

describe('parseRecommendYesNoQuery', () => {
  it('parses yes and no aliases', () => {
    assert.equal(parseRecommendYesNoQuery('yes'), true);
    assert.equal(parseRecommendYesNoQuery('no'), false);
    assert.equal(parseRecommendYesNoQuery(undefined), undefined);
    assert.equal(parseRecommendYesNoQuery('maybe'), undefined);
  });
});

describe('recommend yes flags', () => {
  it('matches list column rules', () => {
    assert.equal(orderRecommendYes({ orderWindowCovered: true, orderQty: 100 }), false);
    assert.equal(orderRecommendYes({ orderWindowCovered: false, orderQty: 0 }), false);
    assert.equal(orderRecommendYes({ orderWindowCovered: false, orderQty: 12 }), true);
    assert.equal(shipRecommendYes({ shipWindowCovered: false, shipQty: 5 }), true);
  });
});
