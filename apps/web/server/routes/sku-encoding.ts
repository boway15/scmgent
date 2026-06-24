import { Hono } from 'hono';
import { parseSkuCode } from '../lib/sku-encoding.js';

export const skuEncodingRoutes = new Hono();

/** 识别 SKU/外部码，返回结构化编码字段（供导入预览、智能体调用） */
skuEncodingRoutes.get('/sku-encoding/parse', async (c) => {
  const code = c.req.query('code') ?? '';
  const externalCode = c.req.query('external_code') ?? undefined;
  return c.json(parseSkuCode(code, externalCode));
});
