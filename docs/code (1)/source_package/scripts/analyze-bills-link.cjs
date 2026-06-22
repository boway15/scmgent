const XLSX = require('xlsx');

const HUAMAO = 'd:\\WXWORK\\WXWork\\1688854726880321\\Cache\\File\\2026-03\\1月深圳市港中旅华贸对账单.xlsx';
const SENWEI = 'd:\\WXWORK\\WXWork\\1688854726880321\\Cache\\File\\2026-03\\2026年1月森威拖车账单明细.xlsx';

function clean(v) {
  return String(v || '').replace(/\s+/g, '').replace(/\n/g, '').toUpperCase();
}

const hrows = XLSX.utils.sheet_to_json(XLSX.readFile(HUAMAO).Sheets['Sheet1'], { header: 1, defval: '' });
const srows = XLSX.utils.sheet_to_json(XLSX.readFile(SENWEI).Sheets['Sheet1'], { header: 1, defval: '' });

const huamao = [];
for (let r = 6; r < hrows.length; r++) {
  const row = hrows[r];
  const orderNo = String(row[0] || '').trim();
  if (!orderNo || orderNo.startsWith('全称')) break;
  huamao.push({
    orderNo,
    bl: clean(row[1]),
    container: clean(row[2]),
    entrust: clean(row[3]),
    volume: row[9],
  });
}

const senwei = [];
for (let r = 2; r < srows.length; r++) {
  const row = srows[r];
  const internal = String(row[0] || '').trim();
  const container = clean(row[2]);
  if (!container) continue;
  senwei.push({
    internal,
    so: clean(row[1]),
    container,
    blHint: clean(row[1]),
  });
}

function matchCount(fn) {
  let n = 0;
  const pairs = [];
  senwei.forEach((s) => {
    const h = huamao.find(fn.bind(null, s));
    if (h) {
      n++;
      pairs.push({ s: s.container, h: h.container, key: `${s.so}/${h.bl}` });
    }
  });
  return { n, pairs };
}

const byBl = matchCount((s, h) => s.so && h.bl && (s.so === h.bl || s.so.includes(h.bl) || h.bl.includes(s.so)));
const byEntrust = matchCount((s, h) => s.internal && h.entrust && s.internal === h.entrust);
const byInternalInEntrust = matchCount((s, h) => h.entrust && s.internal && h.entrust.includes(s.internal.slice(0, 10)));

console.log('华贸样例 BL:', huamao.slice(0, 5).map((x) => x.bl).join(', '));
console.log('森威样例 SO:', senwei.slice(0, 5).map((x) => x.so).join(', '));
console.log('森威样例 internal:', senwei.slice(0, 5).map((x) => x.internal).join(', '));
console.log('华贸有委托编号行:', huamao.filter((x) => x.entrust).length, huamao.filter((x) => x.entrust).map((x) => x.entrust));

console.log('\n按 SO=提单号 匹配:', byBl.n);
byBl.pairs.slice(0, 8).forEach((p) => console.log(' ', p));

console.log('\n按 internal=委托编号 精确匹配:', byEntrust.n);
byEntrust.pairs.forEach((p) => console.log(' ', p));

// partial: internal prefix WJH251219 vs entrust WJH2512190007
const byPrefix = matchCount((s, h) => {
  if (!s.internal || !h.entrust) return false;
  return h.entrust.startsWith(s.internal) || s.internal.startsWith(h.entrust.slice(0, s.internal.length));
});
console.log('\n按委托编号前缀匹配:', byPrefix.n);
byPrefix.pairs.slice(0, 10).forEach((p) => console.log(' ', p));
