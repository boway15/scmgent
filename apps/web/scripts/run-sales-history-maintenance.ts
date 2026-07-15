import { runSalesHistoryMaintenance } from '../server/tasks/salesHistoryMaintenance.js';

const result = await runSalesHistoryMaintenance();
console.log(JSON.stringify(result, null, 2));
