import { scaleChildrenToParent } from './layered-forecast-series.js';

type ReconcileItem = {
  id: string;
  draftQty: number;
  locked: boolean;
  qty: number;
  recent90Qty?: number;
};

type ShareChild = {
  id: string;
  shareKey: number;
  locked: boolean;
  qty: number;
};

export type ReconcileResult = {
  id: string;
  qty: number;
  systemQty: number;
};

/**
 * Reconcile unlocked SKU quantities against a parent total.
 *
 * Locked items keep their `qty`; `systemQty` equals `qty` for locked rows.
 * Unlocked items share `pool = max(parentQty - lockedSum, 0)` by draftQty;
 * if all drafts are zero, fall back to recent90Qty; if still all zero, equal split.
 *
 * When lockedSum <= parentQty, returned qty sums to parentQty.
 * When lockedSum > parentQty (over-lock), unlocked items receive 0 and locked
 * items keep their qty — the total may exceed parentQty.
 */
export function reconcileUnlocked(input: {
  parentQty: number;
  items: ReconcileItem[];
}): ReconcileResult[] {
  return allocateWithLockPool(input.parentQty, input.items, resolveDraftShareKeys);
}

/**
 * Scale unlocked children by shareKey from the remaining pool after locked qty.
 * Same lock/pool rules as reconcileUnlocked; equal split when all shareKeys are zero.
 */
export function scaleSubtreeByShares(
  parentQty: number,
  children: ShareChild[],
): ReconcileResult[] {
  return allocateWithLockPool(parentQty, children, (unlocked) =>
    unlocked.map((c) => c.shareKey),
  );
}

function resolveDraftShareKeys(
  unlocked: Array<{ draftQty?: number; recent90Qty?: number }>,
): number[] {
  const drafts = unlocked.map((c) => c.draftQty ?? 0);
  const draftSum = drafts.reduce((sum, value) => sum + value, 0);
  if (draftSum > 0) return drafts;

  const recent90 = unlocked.map((c) => c.recent90Qty ?? 0);
  const recent90Sum = recent90.reduce((sum, value) => sum + value, 0);
  if (recent90Sum > 0) return recent90;

  return unlocked.map(() => 1);
}

function allocateWithLockPool<T extends { id: string; locked: boolean; qty: number }>(
  parentQty: number,
  items: T[],
  shareKeysFor: (unlocked: T[]) => number[],
): ReconcileResult[] {
  const lockedSum = items.filter((item) => item.locked).reduce((sum, item) => sum + item.qty, 0);
  const pool = Math.max(parentQty - lockedSum, 0);

  const unlockedIndices: number[] = [];
  const unlockedItems: T[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (!item.locked) {
      unlockedIndices.push(i);
      unlockedItems.push(item);
    }
  }

  const shareKeys = shareKeysFor(unlockedItems);
  const allocated = scaleChildrenToParent(pool, shareKeys);

  const qtyByIndex = new Map<number, number>();
  for (let i = 0; i < unlockedIndices.length; i++) {
    qtyByIndex.set(unlockedIndices[i]!, allocated[i] ?? 0);
  }

  return items.map((item, index) => {
    if (item.locked) {
      return { id: item.id, qty: item.qty, systemQty: item.qty };
    }
    const qty = qtyByIndex.get(index) ?? 0;
    return { id: item.id, qty, systemQty: qty };
  });
}
