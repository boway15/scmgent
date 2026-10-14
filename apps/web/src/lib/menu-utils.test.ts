import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canAccessPath } from './menu-utils.js';

describe('canAccessPath merged inventory menus', () => {
  it('lets legacy paths through when the merged menu is granted', () => {
    const allowed = ['/inventory/overview', '/inventory/pools', '/inventory/safety'];
    assert.equal(canAccessPath('/inventory/query', allowed), true);
    assert.equal(canAccessPath('/inventory/procurement-ops', allowed), true);
    assert.equal(canAccessPath('/inventory/unallocated', allowed), true);
    assert.equal(canAccessPath('/inventory/lead-time', allowed), true);
  });

  it('routes SKU planning entry and detail through the planning dashboard grant', () => {
    const allowed = ['/inventory/planning-dashboard'];
    assert.equal(canAccessPath('/inventory/planning', allowed), true);
    assert.equal(canAccessPath('/inventory/planning/sku-1', allowed), true);
  });

  it('still denies legacy paths without the merged menu', () => {
    const allowed = ['/inventory/alerts'];
    assert.equal(canAccessPath('/inventory/query', allowed), false);
    assert.equal(canAccessPath('/inventory/unallocated', allowed), false);
    assert.equal(canAccessPath('/inventory/planning', allowed), false);
  });
});
