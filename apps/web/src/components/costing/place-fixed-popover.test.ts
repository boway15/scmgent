import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { placeFixedPopover } from './place-fixed-popover.js';

const trigger = { top: 200, left: 120, right: 180, bottom: 220 };

describe('placeFixedPopover', () => {
  it('places the panel below the trigger when there is room', () => {
    assert.deepEqual(
      placeFixedPopover({
        trigger,
        panelWidth: 384,
        panelHeight: 280,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
      { top: 224, left: 120 },
    );
  });

  it('flips above the trigger when the panel would overflow the viewport bottom', () => {
    assert.deepEqual(
      placeFixedPopover({
        trigger: { top: 520, left: 120, right: 180, bottom: 540 },
        panelWidth: 384,
        panelHeight: 280,
        viewportWidth: 1280,
        viewportHeight: 600,
      }),
      { top: 236, left: 120 },
    );
  });

  it('clamps left so the panel stays inside the viewport', () => {
    assert.deepEqual(
      placeFixedPopover({
        trigger: { top: 200, left: 1100, right: 1160, bottom: 220 },
        panelWidth: 384,
        panelHeight: 280,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
      { top: 224, left: 888 },
    );
  });
});
