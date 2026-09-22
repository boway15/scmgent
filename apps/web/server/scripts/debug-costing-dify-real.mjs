import { extractPptxSlideTexts } from '../lib/product-costing/preprocess/pptx-text.ts';

const base = (process.env.DIFY_BASE_URL || '').replace(/\/$/, '');
const key = process.env.DIFY_API_KEY_COSTING_BOM;
const pptx = process.argv[2];
const map = await extractPptxSlideTexts(pptx);
const pages = [...map.entries()]
  .sort((a, b) => a[0] - b[0])
  .slice(0, 4)
  .map(([page, text]) => ({ page, text, image_base64: '' }));
console.log(
  'sending pages',
  pages.map((p) => ({ page: p.page, textLen: p.text.length })),
);

const res = await fetch(`${base}/workflows/run`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    inputs: { category: '实木办公桌', pages_json: JSON.stringify(pages) },
    response_mode: 'blocking',
    user: 'debug-costing-real',
  }),
  signal: AbortSignal.timeout(180_000),
});
const json = await res.json();
console.log('status', res.status, json.data?.status);
console.log('error', json.data?.error?.slice?.(0, 300));
const lines = json.data?.outputs?.lines;
console.log('lines type', typeof lines);
console.log(typeof lines === 'string' ? lines.slice(0, 1500) : JSON.stringify(lines)?.slice(0, 1500));
