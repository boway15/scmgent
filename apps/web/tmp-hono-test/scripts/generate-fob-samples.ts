/**
 * 生成 FOB 分账三类导入示例（柜号对齐，便于本地核算联调）
 * 用法: cd apps/web && pnpm exec tsx server/scripts/generate-fob-samples.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '../../../../docs/samples/fob');

const MERCHANTS = [
  '傲杰科技国际有限公司',
  '郑州傲杰',
  '贝斯旺国际有限公司',
  '厦门鹭泓森供应链有限公司',
];

const FACTORIES = [
  '曹县海庆家具有限公司',
  '厦门鹭泓森供应链有限公司',
  '泉州恒美家居有限公司',
];

const DEST_PORTS = ['汉堡', '鹿特丹', '安特卫普', '费利克斯托', '洛杉矶'];

function makeContainer(i: number): string {
  const prefixes = ['TGBU', 'FFAU', 'SEKU', 'OOCU', 'CSNU', 'EGSU', 'YMLU', 'TRHU', 'CMAU', 'BMOU'];
  const prefix = prefixes[i % prefixes.length];
  const num = String(1_000_000 + i * 7_919).padStart(7, '0').slice(-7);
  return `${prefix}${num}`;
}

const CONTAINERS = Array.from({ length: 50 }, (_, i) => makeContainer(i));

function buildVolumeRows(): unknown[][] {
  const rows: unknown[][] = [
    ['说明：Demo 数据 — 50 柜、60+ Sku 行；柜号与拖车/货代示例一致'],
    ['柜号', '业务编号', 'Sku', '体积/m3', '法人主体', '工厂名称', '工厂类别'],
  ];

  let skuSeq = 1;
  for (let i = 0; i < CONTAINERS.length; i++) {
    const container = CONTAINERS[i];
    const bizNo = `DEMO202606${String(i + 1).padStart(4, '0')}`;
    const factory = FACTORIES[i % FACTORIES.length];
    const merchantCount = i % 5 === 0 ? 2 : 1;

    for (let m = 0; m < merchantCount; m++) {
      const merchant = MERCHANTS[(i + m) % MERCHANTS.length];
      const skuCount = m === 0 ? 2 : 1;
      for (let s = 0; s < skuCount; s++) {
        const sku = `DJ${String(500000 + skuSeq).slice(-6)}_${(s % 3) + 1}`;
        const volume = round2(3 + ((i + m + s) % 7) * 1.15 + 0.37);
        const factoryType = s === 0 ? 'FOB' : i % 3 === 0 ? '非退税' : '退税';
        rows.push([container, bizNo, sku, volume, merchant, factory, factoryType]);
        skuSeq++;
      }
    }
  }

  return rows;
}

function buildTruckingRows(): unknown[][] {
  const header = [
    '内部编号',
    '提单号',
    '柜号',
    '装货地址',
    '船期',
    '',
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
    '',
    '',
    '',
    '',
    '',
    '',
    '备注(CNY)',
  ];

  const rows: unknown[][] = [
    ['说明：Demo 数据 — 50 柜拖车账单，柜号与体积/货代示例一致'],
    header,
  ];

  for (let i = 0; i < CONTAINERS.length; i++) {
    const container = CONTAINERS[i];
    const internalNo = `DEMO202606${String(i + 1).padStart(4, '0')}`;
    const blNo = `BL202606${String(i + 1).padStart(5, '0')}`;
    const trucking = 1200 + (i % 8) * 80;
    const customs = 280 + (i % 5) * 20;
    const terminal = i % 4 === 0 ? 150 + (i % 3) * 30 : '';
    const portMisc = i % 6 === 0 ? 90 : '';
    rows.push([
      internalNo,
      blNo,
      container,
      i % 2 === 0 ? '厦门' : '深圳',
      '2026-06-15',
      '',
      String(trucking),
      String(customs),
      '',
      i % 7 === 0 ? '120' : '',
      terminal,
      portMisc,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ]);
  }

  return rows;
}

function buildFreightRows(): unknown[][] {
  const header: unknown[] = new Array(42).fill('');
  header[0] = '工作号';
  header[1] = '提单号';
  header[2] = '柜号';
  header[7] = '业务日期';
  header[8] = '目的港';
  header[9] = '体积';
  header[12] = '海运费(CNY)';
  header[14] = '文件费(CNY)';
  header[16] = 'VGM(CNY)';
  header[26] = '工作号';
  header[27] = '提单号';
  header[28] = '柜号';
  header[33] = '业务日期';
  header[34] = '目的港';
  header[35] = '体积';
  header[36] = '拖车费(CNY)';
  header[38] = '报关费(CNY)';

  const rows: unknown[][] = [
    ['说明：Demo 数据 — 50 柜货代账单，柜号与体积/货代示例一致'],
    [''],
    [''],
    [''],
    [''],
    header,
  ];

  for (let i = 0; i < CONTAINERS.length; i++) {
    const container = CONTAINERS[i];
    const orderNo = `DEMO202606${String(i + 1).padStart(4, '0')}`;
    const blNo = `BL202606${String(i + 1).padStart(5, '0')}`;
    const dest = DEST_PORTS[i % DEST_PORTS.length];
    const volume = round2(18 + (i % 10) * 2.35);
    const oceanCny = 980 + (i % 12) * 45;
    const docCny = 35 + (i % 4) * 5;
    const vgmCny = i % 5 === 0 ? 25 : '';
    const truckingCny = 600 + (i % 6) * 50;
    const customsCny = 260 + (i % 4) * 15;

    const row: unknown[] = new Array(42).fill('');
    row[0] = orderNo;
    row[1] = blNo;
    row[2] = container;
    row[7] = '2026-06-20';
    row[8] = dest;
    row[9] = String(volume);
    row[12] = String(oceanCny);
    row[14] = String(docCny);
    if (vgmCny) row[16] = String(vgmCny);
    row[26] = orderNo;
    row[27] = blNo;
    row[28] = container;
    row[33] = '2026-06-20';
    row[34] = dest;
    row[35] = String(volume);
    row[36] = String(truckingCny);
    row[38] = String(customsCny);
    rows.push(row);
  }

  return rows;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

async function main() {
  const XLSX = await import('xlsx');
  mkdirSync(OUT_DIR, { recursive: true });

  const volumeRows = buildVolumeRows();
  const truckingRows = buildTruckingRows();
  const freightRows = buildFreightRows();

  const volumeDataRows = volumeRows.length - 2;
  const truckingDataRows = truckingRows.length - 2;
  const freightDataRows = freightRows.length - 6;

  const files = [
    { name: '01-volume-ed.xlsx', sheet: '体积信息', rows: volumeRows },
    { name: '02-trucking-bill.xlsx', sheet: '拖车账单', rows: truckingRows },
    { name: '03-freight-bill.xlsx', sheet: '货代账单', rows: freightRows },
  ];

  for (const f of files) {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(f.rows);
    XLSX.utils.book_append_sheet(wb, ws, f.sheet);
    const path = join(OUT_DIR, f.name);
    XLSX.writeFile(wb, path);
    console.log(`Wrote ${path} (${f.rows.length} sheet rows)`);
  }

  const readme = `# FOB 分账示例数据

三类文件的 **柜号完全一致**（50 柜），可直接用于本地分摊核算联调。

| 文件 | 数据行数 | 说明 |
|------|----------|------|
| \`01-volume-ed.xlsx\` | ${volumeDataRows} 行 | ED 大件调拨导出格式；含 FOB/混柜行 |
| \`02-trucking-bill.xlsx\` | ${truckingDataRows} 行 | 拖车行宽表；拖车费+报关费等 |
| \`03-freight-bill.xlsx\` | ${freightDataRows} 行 | 货代对账单双栏；金额均为人民币 |

## 使用步骤

1. 新建 FOB 分账批次
2. **数据导入** Tab 依次上传上述三个 xlsx
3. **分摊平账** → 执行分摊核算（柜号匹配诊断应显示 50 柜可分摊）
4. 查看主体承担汇总 / 按柜平账校验

## 重新生成

\`\`\`bash
cd apps/web && pnpm exec tsx server/scripts/generate-fob-samples.ts
\`\`\`

## 柜号列表（前 10 个）

${CONTAINERS.slice(0, 10).map((c) => `- \`${c}\``).join('\n')}
…共 ${CONTAINERS.length} 柜
`;

  writeFileSync(join(OUT_DIR, 'README.md'), readme, 'utf8');
  console.log(`\nSummary: volume=${volumeDataRows} trucking=${truckingDataRows} freight=${freightDataRows} containers=${CONTAINERS.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
