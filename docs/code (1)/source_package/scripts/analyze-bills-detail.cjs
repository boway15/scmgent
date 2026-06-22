const XLSX = require('xlsx');

const HUAMAO = 'd:\\WXWORK\\WXWork\\1688854726880321\\Cache\\File\\2026-03\\1月深圳市港中旅华贸对账单.xlsx';
const SENWEI = 'd:\\WXWORK\\WXWork\\1688854726880321\\Cache\\File\\2026-03\\2026年1月森威拖车账单明细.xlsx';

function parseAmount(v) {
  if (v == null || v === '' || v === ' ') return 0;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

function cleanContainer(v) {
  return String(v || '')
    .replace(/\s+/g, '')
    .replace(/\n/g, '')
    .toUpperCase();
}

// --- Huamao ---
const hwb = XLSX.readFile(HUAMAO);
const hrows = XLSX.utils.sheet_to_json(hwb.Sheets['Sheet1'], { header: 1, defval: '' });
const hHeader = hrows[5];
const leftStart = 0;
const rightStart = 25;

const leftFeeCols = [];
const rightFeeCols = [];
hHeader.forEach((h, i) => {
  const name = String(h).replace(/\n/g, ' ').trim();
  if (!name) return;
  if (i >= leftStart && i < rightStart && /\(USD\)|USD/.test(name) && !/合计/.test(name)) leftFeeCols.push({ i, name });
  if (i >= rightStart && /\(CNY\)|CNY/.test(name) && !/合计/.test(name)) rightFeeCols.push({ i, name });
});

console.log('=== 华贸：USD 费用列 ===');
leftFeeCols.forEach((c) => console.log(`  col${c.i}: ${c.name}`));
console.log('=== 华贸：CNY 费用列 ===');
rightFeeCols.forEach((c) => console.log(`  col${c.i}: ${c.name}`));

const huamaoRecords = [];
for (let r = 6; r < hrows.length; r++) {
  const row = hrows[r];
  const orderNo = String(row[0] || '').trim();
  if (!orderNo || orderNo.startsWith('全称') || orderNo.startsWith('开户') || orderNo.startsWith('帐号')) break;
  const container = cleanContainer(row[2]);
  if (!container) continue;

  const parsePanel = (base) => ({
    orderNo: String(row[base] || '').trim(),
    blNo: String(row[base + 1] || '').trim(),
    container: cleanContainer(row[base + 2]),
    entrustNo: String(row[base + 3] || '').trim(),
    bizDate: String(row[base + 7] || '').trim(),
    destPort: String(row[base + 8] || '').trim(),
    volume: parseAmount(row[base + 9]),
    fees: [],
  });

  const left = parsePanel(0);
  leftFeeCols.forEach(({ i, name }) => {
    const amt = parseAmount(row[i]);
    if (amt) left.fees.push({ currency: 'USD', feeType: name, amount: amt });
  });
  const usdTotal = parseAmount(row[21]);
  const leftRmbTotal = parseAmount(row[22]);

  const right = parsePanel(25);
  rightFeeCols.forEach(({ i, name }) => {
    const amt = parseAmount(row[i]);
    if (amt) right.fees.push({ currency: 'CNY', feeType: name, amount: amt });
  });
  const rightUsdTotal = parseAmount(row[52]);
  const rightRmbTotal = parseAmount(row[53]);

  huamaoRecords.push({ row: r + 1, left, right, usdTotal, leftRmbTotal, rightRmbTotal });
}

console.log(`\n华贸数据行: ${huamaoRecords.length}`);
const hContainers = new Set(huamaoRecords.map((x) => x.left.container));
console.log(`华贸柜号数: ${hContainers.size}`);

let usdFeeSum = 0;
let cnyFeeSum = 0;
huamaoRecords.forEach((rec) => {
  rec.left.fees.forEach((f) => (usdFeeSum += f.amount));
  rec.right.fees.forEach((f) => (cnyFeeSum += f.amount));
});
console.log(`华贸 USD 明细合计(未换汇): ${usdFeeSum.toFixed(2)}`);
console.log(`华贸 CNY 明细合计: ${cnyFeeSum.toFixed(2)}`);

// fee type aggregation CNY
const hCnyByType = {};
huamaoRecords.forEach((rec) => {
  rec.right.fees.forEach((f) => {
    hCnyByType[f.feeType] = (hCnyByType[f.feeType] || 0) + f.amount;
  });
});
console.log('\n华贸 CNY 费用项汇总:');
Object.entries(hCnyByType)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${k}: ${v.toFixed(2)}`));

// --- Senwei ---
const swb = XLSX.readFile(SENWEI);
const srows = XLSX.utils.sheet_to_json(swb.Sheets['Sheet1'], { header: 1, defval: '' });
const sHeader = srows[1];
const feeColNames = [
  '拖车费',
  '报关费',
  '堆存费',
  '多点提货费',
  '码头费',
  '港杂费',
  '超期费',
  '超时等待费',
  '落地寄柜费',
  '压夜费',
  '指定柜号',
  '其他费用',
];
const feeColIdx = feeColNames.map((n) => sHeader.indexOf(n));

const senweiRecords = [];
for (let r = 2; r < srows.length; r++) {
  const row = srows[r];
  const internalNo = String(row[0] || '').trim();
  const so = String(row[1] || '').trim();
  const container = cleanContainer(row[2]);
  if (!container && !internalNo) continue;
  if (!container && internalNo && /递延|减免|FOB|多收|应付款/.test(internalNo)) continue;
  if (!container) continue;

  const fees = [];
  feeColNames.forEach((name, idx) => {
    const col = feeColIdx[idx];
    const amt = parseAmount(row[col]);
    if (amt) fees.push({ feeType: name, amount: amt });
  });
  const total = parseAmount(row[sHeader.indexOf('费用合计(CNY)')]);

  const addresses = String(row[3] || '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);

  senweiRecords.push({
    row: r + 1,
    internalNo,
    so,
    container,
    shipDate: String(row[4] || '').trim(),
    addresses,
    merchantHints: addresses.map((a) => a.split(/\s+/)[0]),
    fees,
    total,
    remark: String(row[sHeader.indexOf('备注(CNY)')] || '').trim(),
  });
}

// remove total row if no internal no pattern
const dataRows = senweiRecords.filter((x) => x.internalNo && x.container);
console.log(`\n森威数据行: ${dataRows.length}`);
const sContainers = new Set(dataRows.map((x) => x.container));
console.log(`森威柜号数: ${sContainers.size}`);

const sByType = {};
let sTotal = 0;
dataRows.forEach((rec) => {
  rec.fees.forEach((f) => {
    sByType[f.feeType] = (sByType[f.feeType] || 0) + f.amount;
  });
  sTotal += rec.total;
});
console.log(`森威费用合计(行合计): ${sTotal.toFixed(2)}`);
console.log('\n森威费用项汇总:');
Object.entries(sByType)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${k}: ${v.toFixed(2)}`));

// cross match
const both = [...hContainers].filter((c) => sContainers.has(c));
const onlyH = [...hContainers].filter((c) => !sContainers.has(c));
const onlyS = [...sContainers].filter((c) => !hContainers.has(c));
console.log(`\n柜号交集: ${both.length}`);
console.log(`仅华贸: ${onlyH.length}`, onlyH.slice(0, 10).join(', '));
console.log(`仅森威: ${onlyS.length}`, onlyS.slice(0, 10).join(', '));

// sample match
if (both.length) {
  const c = both[0];
  const h = huamaoRecords.find((x) => x.left.container === c);
  const s = dataRows.find((x) => x.container === c);
  console.log(`\n样例柜号 ${c}:`);
  console.log('  华贸 订单:', h?.left.orderNo, '体积:', h?.left.volume, 'CNY费项数:', h?.right.fees.length);
  console.log('  森威 内部号:', s?.internalNo, 'SO:', s?.so, '地址数:', s?.addresses.length);
  console.log('  森威 工厂:', s?.merchantHints.join(' | '));
}

// multi-address stats
const multi = dataRows.filter((x) => x.addresses.length > 1);
console.log(`\n森威多工厂装柜行: ${multi.length} / ${dataRows.length}`);
multi.slice(0, 5).forEach((x) => {
  console.log(`  ${x.container}: ${x.merchantHints.join(' + ')} 合计${x.total}`);
});
