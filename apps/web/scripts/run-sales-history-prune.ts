import { pruneSalesHistoryDailyBeyondRetention } from '../server/lib/sales-history-retention.js';

const result = await pruneSalesHistoryDailyBeyondRetention();
console.log(JSON.stringify(result, null, 2));
