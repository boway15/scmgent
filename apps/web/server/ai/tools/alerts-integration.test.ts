import { config } from 'dotenv';
import { join } from 'path';
import assert from 'node:assert/strict';

config({ path: join(process.cwd(), '../../.env') });
config({ path: join(process.cwd(), '.env') });

const { getRecentOpenAlerts, countOpenAlerts } = await import('./alerts.js');

const [count, rows] = await Promise.all([countOpenAlerts(), getRecentOpenAlerts(3)]);
assert.equal(typeof count, 'number');
assert.ok(Array.isArray(rows));
console.log('alerts query ok:', count, 'rows', rows.length);
