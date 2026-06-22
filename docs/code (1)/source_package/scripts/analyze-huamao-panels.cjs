const XLSX = require('xlsx');

function clean(v) {
  return String(v || '')
    .replace(/\s+/g, '')
    .replace(/\n/g, '')
    .toUpperCase();
}
function parseAmt(v) {
  const n = Number(String(v || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : 0;
}

const path =
  'd:\\WXWORK\\WXWork\\1688854726880321\\Cache\\File\\2026-03\\1月深圳市港中旅华贸对账单.xlsx';
const h = XLSX.utils.sheet_to_json(XLSX.readFile(path).Sheets['Sheet1'], { header: 1, defval: '' });
const hdr = h[5];

const leftFees = [];
const rightFees = [];
hdr.forEach((name, i) => {
  const n = String(name).replace(/\n/g, ' ').trim();
  if (i <= 24 && /\(USD\)/.test(n) && !/合计/.test(n)) leftFees.push(i);
  if (i >= 26 && /\(CNY\)/.test(n) && !/合计/.test(n)) rightFees.push(i);
});

console.log('left fee cols', leftFees.length, 'right fee cols', rightFees.length);

const recs = [];
for (let r = 6; r < h.length; r++) {
  const row = h[r];
  const o = String(row[0] || '').trim();
  if (!o || o.startsWith('全称')) break;

  const panels = [
    { base: 0, fees: leftFees, ccy: 'USD' },
    { base: 26, fees: rightFees, ccy: 'CNY' },
  ];

  for (const p of panels) {
    const container = clean(row[p.base + 2]);
    if (!container) continue;
    const fees = [];
    p.fees.forEach((i) => {
      const a = parseAmt(row[i]);
      if (a) fees.push({ name: String(hdr[i]).replace(/\n/g, ' '), amount: a });
    });
    recs.push({
      row: r + 1,
      order: String(row[p.base] || '').trim(),
      bl: String(row[p.base + 1] || '').trim(),
      container,
      ccy: p.ccy,
      volume: parseAmt(row[p.base + 9]),
      fees,
      feeSum: fees.reduce((s, f) => s + f.amount, 0),
    });
  }
}

console.log('总记录', recs.length);
const usd = recs.filter((x) => x.ccy === 'USD' && x.feeSum > 0);
const cny = recs.filter((x) => x.ccy === 'CNY' && x.feeSum > 0);
console.log('有费用 USD', usd.length, 'CNY', cny.length);
console.log('USD合计', usd.reduce((s, x) => s + x.feeSum, 0).toFixed(2));
console.log('CNY合计', cny.reduce((s, x) => s + x.feeSum, 0).toFixed(2));

const sameRowPairs = [];
for (let r = 7; r <= 27; r++) {
  const left = recs.find((x) => x.row === r && x.ccy === 'USD');
  const right = recs.find((x) => x.row === r && x.ccy === 'CNY');
  if (left && right) {
    sameRowPairs.push({
      row: r,
      sameShipment: left.container === right.container,
      left: `${left.order}/${left.container}`,
      right: `${right.order}/${right.container}`,
    });
  }
}
console.log('\n同行左右是否同一票货:');
console.log('  同一柜', sameRowPairs.filter((x) => x.sameShipment).length);
console.log('  不同柜', sameRowPairs.filter((x) => !x.sameShipment).length);
sameRowPairs.filter((x) => !x.sameShipment).slice(0, 5).forEach((x) => console.log(' ', x));
