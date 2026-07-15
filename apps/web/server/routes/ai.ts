import { Hono } from 'hono';
import {
  chat,
  getAiConfigSummary,
  getConversationMessages,
  listConversations,
} from '../ai/index.js';
import { checkAiRateLimit } from '../lib/ai-rate-limit.js';
import { getCurrentUser } from '../lib/auth-context.js';
import { requireMenu } from '../lib/rbac.js';

export const aiRoutes = new Hono();

aiRoutes.get('/ai/config', (c) => c.json(getAiConfigSummary()));

aiRoutes.get('/ai/conversations', async (c) => {
  const user = await getCurrentUser(c);
  const rows = await listConversations(user.id);
  return c.json(rows);
});

aiRoutes.get('/ai/conversations/:id/messages', async (c) => {
  const user = await getCurrentUser(c);
  const convId = c.req.param('id');
  const result = await getConversationMessages(user.id, convId);
  if (!result) return c.json({ message: 'Conversation not found' }, 404);
  return c.json(result);
});

aiRoutes.post('/ai/chat', requireMenu('ai.chat'), async (c) => {
  const user = await getCurrentUser(c);
  const rate = checkAiRateLimit(user.id);
  if (!rate.ok) {
    return c.json({ message: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s` }, 429);
  }

  const body = await c.req.json<{
    query: string;
    conversationId?: string;
    skuCode?: string;
    skuId?: string;
    warehouseCode?: string;
  }>();

  if (!body.query?.trim()) {
    return c.json({ message: 'query is required' }, 400);
  }

  try {
    const result = await chat({
      query: body.query,
      userId: user.id,
      conversationId: body.conversationId,
      context: {
        skuId: body.skuId,
        skuCode: body.skuCode,
        warehouseCode: body.warehouseCode,
      },
    });

    return c.json({
      answer: result.answer,
      conversationId: result.conversationId,
      sources: result.sources,
      mode: result.mode,
      fallback: result.fallback,
      difyEnabled: result.difyEnabled,
      runId: result.runId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed';
    return c.json({ message }, 502);
  }
});
