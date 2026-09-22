import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectApplyFactsStale,
  hasAppliedStructureCuts,
  patchTouchesStructureFacts,
} from './apply-facts-stale.js';

describe('patchTouchesStructureFacts', () => {
  it('detects structure field patches', () => {
    assert.equal(patchTouchesStructureFacts({ drawerCount: 9 }), true);
    assert.equal(patchTouchesStructureFacts({ name: 'foo' }), false);
  });
});

describe('detectApplyFactsStale', () => {
  it('is false before first apply', () => {
    assert.equal(
      detectApplyFactsStale({ status: 'draft', drawerCount: 9, category: '斗柜' }, []),
      false,
    );
  });

  it('is true after structure patch invalidated ready project', () => {
    assert.equal(
      detectApplyFactsStale(
        { status: 'draft', drawerCount: 9, category: '斗柜' },
        [
          {
            materialName: '侧板',
            qtyNet: 2,
            origin: 'template',
            notes: '由结构关系推算',
            spec: '18mm 400×785',
          },
        ],
      ),
      true,
    );
  });

  it('detects slide qty mismatch with drawer count', () => {
    assert.equal(
      detectApplyFactsStale(
        { status: 'ready', drawerCount: 9, category: '斗柜' },
        [
          { materialName: '抽屉滑轨', qtyNet: 6, origin: 'template', notes: '一抽一套滑轨', spec: '' },
          { materialName: '侧板', qtyNet: 2, origin: 'template', notes: '由结构关系推算', spec: '18mm 400×785' },
        ],
      ),
      true,
    );
    assert.equal(hasAppliedStructureCuts([{ materialName: '抽屉滑轨', qtyNet: 6, origin: 'template', notes: '一抽一套滑轨' }]), true);
  });
});
