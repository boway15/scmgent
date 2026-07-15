import assert from 'node:assert/strict';
import { stockAlerts } from '@scm/db';

function testStockAlertsSchemaFields() {
  assert.ok(stockAlerts.notifiedAt, 'stockAlerts.notifiedAt must exist');
  assert.equal((stockAlerts as { createdAt?: unknown }).createdAt, undefined);
}

testStockAlertsSchemaFields();
console.log('alerts tool schema test passed');
