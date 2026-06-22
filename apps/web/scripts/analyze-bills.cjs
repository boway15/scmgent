const XLSX = require('xlsx');
const { existsSync } = require('fs');

const files = [
  {
    label: '华贸对账单',
    path: 'd:\\WXWORK\\WXWork\\1688854726880321\\Cache\\File\\2026-03\\1月深圳市港中旅华贸对账单.xlsx',
  },
  {
    label: '森威拖车',
    path: 'd:\\WXWORK\\WXWork\\1688854726880321\\Cache\\File\\2026-03\\2026年1月森威拖车账单明细.xlsx',
  },
];

for (const f of files) {
  console.log('\n' + '='.repeat(80));
  console.log('FILE:', f.label);
  console.log('PATH:', f.path);
  console.log('EXISTS:', existsSync(f.path));

  if (!existsSync(f.path)) {
    console.error('File not found');
    continue;
  }

  const wb = XLSX.readFile(f.path);
  console.log('Sheets:', JSON.stringify(wb.SheetNames));

  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const ref = sheet['!ref'] || 'A1';
    const range = XLSX.utils.decode_range(ref);
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

    console.log(`\n--- Sheet: ${name} | rows: ${rows.length} | cols: ${range.e.c + 1} ---`);

    let printed = 0;
    for (let i = 0; i < rows.length && printed < 45; i++) {
      const row = rows[i];
      const nonEmpty = row.filter((c) => String(c).trim() !== '');
      if (nonEmpty.length === 0) continue;
      console.log(`${String(i + 1).padStart(3)}| ${JSON.stringify(row)}`);
      printed++;
    }

    for (let i = 0; i < Math.min(rows.length, 30); i++) {
      const joined = rows[i].map((c) => String(c)).join('|');
      if (/费用|金额|柜|箱|费目|项目|摘要|应付|含税|体积|商家|客户|拖车|海运费|关税/.test(joined)) {
        console.log(`>> Possible header row ${i + 1}:`, JSON.stringify(rows[i]));
      }
    }

    const json = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
    if (json.length) {
      console.log('>> Auto columns:', Object.keys(json[0]).join(', '));
      console.log('>> Sample rows:', json.length);
      json.slice(0, 5).forEach((r, idx) => console.log(`   ${idx + 1}:`, JSON.stringify(r)));
      if (json.length > 5) {
        console.log('>> Last 2 rows:');
        json.slice(-2).forEach((r, idx) => console.log(`   ${idx + 1}:`, JSON.stringify(r)));
      }
    }
  }
}
