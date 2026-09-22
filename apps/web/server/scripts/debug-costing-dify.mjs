const base = (process.env.DIFY_BASE_URL || '').replace(/\/$/, '');
const key = process.env.DIFY_API_KEY_COSTING_BOM;
if (!base || !key) {
  console.error('missing DIFY_BASE_URL or DIFY_API_KEY_COSTING_BOM');
  process.exit(1);
}
const pages = [
  {
    page: 1,
    text: '台面 多层实木板 18mm 1800x800\n五金 螺丝 M6 x20\n封边条 ABS 2mm',
    image_base64: '',
  },
];
const res = await fetch(`${base}/workflows/run`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    inputs: {
      category: '板式办公桌',
      pages_json: JSON.stringify(pages),
    },
    response_mode: 'blocking',
    user: 'debug-costing',
  }),
  signal: AbortSignal.timeout(180_000),
});
const text = await res.text();
console.log('status', res.status);
console.log(text.slice(0, 6000));
