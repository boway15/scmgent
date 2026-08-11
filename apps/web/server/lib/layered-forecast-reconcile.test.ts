import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { reconcileUnlocked, scaleSubtreeByShares } from './layered-forecast-reconcile.js';

describe('layered-forecast-reconcile', () => {
  describe('reconcileUnlocked', () => {
    it('allocates pool by draftQty among unlocked items', () => {
      const result = reconcileUnlocked({
        parentQty: 100,
        items: [
          { id: 'a', draftQty: 30, locked: false, qty: 0 },
          { id: 'b', draftQty: 70, locked: false, qty: 0 },
        ],
      });
      assert.equal(result.length, 2);
      assert.equal(result[0]!.id, 'a');
      assert.equal(result[0]!.qty, 30);
      assert.equal(result[0]!.systemQty, 30);
      assert.equal(result[1]!.qty, 70);
      assert.equal(result[1]!.systemQty, 70);
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 100);
    });

    it('reserves locked qty from parent and splits remaining pool', () => {
      const result = reconcileUnlocked({
        parentQty: 100,
        items: [
          { id: 'locked', draftQty: 50, locked: true, qty: 40 },
          { id: 'u1', draftQty: 30, locked: false, qty: 10 },
          { id: 'u2', draftQty: 70, locked: false, qty: 20 },
        ],
      });
      const locked = result.find((r) => r.id === 'locked')!;
      const u1 = result.find((r) => r.id === 'u1')!;
      const u2 = result.find((r) => r.id === 'u2')!;

      assert.equal(locked.qty, 40);
      assert.equal(locked.systemQty, 40);
      // pool = 100 - 40 = 60; share 30:70 → 18, 42
      assert.equal(u1.qty, 18);
      assert.equal(u2.qty, 42);
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 100);
    });

    it('falls back to recent90Qty when all drafts are zero', () => {
      const result = reconcileUnlocked({
        parentQty: 100,
        items: [
          { id: 'a', draftQty: 0, locked: false, qty: 0, recent90Qty: 25 },
          { id: 'b', draftQty: 0, locked: false, qty: 0, recent90Qty: 75 },
        ],
      });
      assert.equal(result[0]!.qty, 25);
      assert.equal(result[1]!.qty, 75);
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 100);
    });

    it('splits equally when drafts and recent90 are all zero', () => {
      const result = reconcileUnlocked({
        parentQty: 100,
        items: [
          { id: 'a', draftQty: 0, locked: false, qty: 0 },
          { id: 'b', draftQty: 0, locked: false, qty: 0 },
          { id: 'c', draftQty: 0, locked: false, qty: 0 },
        ],
      });
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 100);
      assert.deepEqual(
        result.map((r) => r.qty),
        [33.33, 33.33, 33.34],
      );
    });

    it('ignores locked items when falling back to recent90', () => {
      const result = reconcileUnlocked({
        parentQty: 50,
        items: [
          { id: 'locked', draftQty: 0, locked: true, qty: 20, recent90Qty: 999 },
          { id: 'u1', draftQty: 0, locked: false, qty: 0, recent90Qty: 30 },
          { id: 'u2', draftQty: 0, locked: false, qty: 0, recent90Qty: 70 },
        ],
      });
      assert.equal(result.find((r) => r.id === 'locked')!.qty, 20);
      // pool = 50 - 20 = 30; share 30:70
      assert.equal(result.find((r) => r.id === 'u1')!.qty, 9);
      assert.equal(result.find((r) => r.id === 'u2')!.qty, 21);
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 50);
    });

    it('gives unlocked zero when locked sum exceeds parent (over-lock)', () => {
      const result = reconcileUnlocked({
        parentQty: 50,
        items: [
          { id: 'l1', draftQty: 0, locked: true, qty: 30 },
          { id: 'l2', draftQty: 0, locked: true, qty: 30 },
          { id: 'u1', draftQty: 100, locked: false, qty: 0 },
        ],
      });
      assert.equal(result.find((r) => r.id === 'l1')!.qty, 30);
      assert.equal(result.find((r) => r.id === 'l2')!.qty, 30);
      assert.equal(result.find((r) => r.id === 'u1')!.qty, 0);
      // sum = 60 > parent 50 — documented over-lock behavior
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 60);
    });

    it('rounds to 2 decimals and adjusts last unlocked item', () => {
      const result = reconcileUnlocked({
        parentQty: 10,
        items: [
          { id: 'a', draftQty: 1, locked: false, qty: 0 },
          { id: 'b', draftQty: 2, locked: false, qty: 0 },
          { id: 'c', draftQty: 3, locked: false, qty: 0 },
        ],
      });
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 10);
      assert.equal(result[0]!.qty, 1.67);
      assert.equal(result[1]!.qty, 3.33);
      assert.equal(result[2]!.qty, 5);
    });

    it('returns items in input order', () => {
      const result = reconcileUnlocked({
        parentQty: 100,
        items: [
          { id: 'c', draftQty: 10, locked: false, qty: 0 },
          { id: 'a', draftQty: 10, locked: true, qty: 25 },
          { id: 'b', draftQty: 90, locked: false, qty: 0 },
        ],
      });
      assert.deepEqual(result.map((r) => r.id), ['c', 'a', 'b']);
    });
  });

  describe('scaleSubtreeByShares', () => {
    it('scales unlocked children by shareKey from pool', () => {
      const result = scaleSubtreeByShares(100, [
        { id: 'a', shareKey: 25, locked: false, qty: 0 },
        { id: 'b', shareKey: 75, locked: false, qty: 0 },
      ]);
      assert.equal(result[0]!.qty, 25);
      assert.equal(result[1]!.qty, 75);
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 100);
    });

    it('keeps locked children qty and splits pool among unlocked', () => {
      const result = scaleSubtreeByShares(100, [
        { id: 'locked', shareKey: 50, locked: true, qty: 35 },
        { id: 'u1', shareKey: 40, locked: false, qty: 10 },
        { id: 'u2', shareKey: 60, locked: false, qty: 20 },
      ]);
      assert.equal(result.find((r) => r.id === 'locked')!.qty, 35);
      assert.equal(result.find((r) => r.id === 'locked')!.systemQty, 35);
      // pool = 65; 40:60 → 26, 39
      assert.equal(result.find((r) => r.id === 'u1')!.qty, 26);
      assert.equal(result.find((r) => r.id === 'u2')!.qty, 39);
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 100);
    });

    it('splits equally when all shareKeys are zero among unlocked', () => {
      const result = scaleSubtreeByShares(90, [
        { id: 'a', shareKey: 0, locked: false, qty: 0 },
        { id: 'b', shareKey: 0, locked: false, qty: 0 },
        { id: 'c', shareKey: 0, locked: false, qty: 0 },
      ]);
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 90);
      assert.deepEqual(
        result.map((r) => r.qty),
        [30, 30, 30],
      );
    });

    it('gives unlocked zero when locked sum exceeds parent', () => {
      const result = scaleSubtreeByShares(40, [
        { id: 'l1', shareKey: 1, locked: true, qty: 25 },
        { id: 'l2', shareKey: 1, locked: true, qty: 20 },
        { id: 'u1', shareKey: 100, locked: false, qty: 0 },
      ]);
      assert.equal(result.find((r) => r.id === 'u1')!.qty, 0);
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 45);
    });

    it('rounds to 2 decimals and adjusts last unlocked child', () => {
      const result = scaleSubtreeByShares(10, [
        { id: 'a', shareKey: 1, locked: false, qty: 0 },
        { id: 'b', shareKey: 2, locked: false, qty: 0 },
        { id: 'c', shareKey: 3, locked: false, qty: 0 },
      ]);
      assert.equal(result.reduce((s, r) => s + r.qty, 0), 10);
      assert.equal(result[0]!.qty, 1.67);
      assert.equal(result[1]!.qty, 3.33);
      assert.equal(result[2]!.qty, 5);
    });
  });
});
