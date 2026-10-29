import { config } from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../../../.env') });
config({ path: join(__dirname, '../../.env') });

const { syncQcReinspection } = await import('../lib/qc-reinspection-sync.js');
const result = await syncQcReinspection();
console.log(JSON.stringify(result, null, 2));
