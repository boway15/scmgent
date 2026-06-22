import { Hono } from 'hono';
import { eq, and, desc } from 'drizzle-orm';
import { db, kbConversations, kbMessages } from '../_db/index.js';
import { getCurrentUser } from '../lib/auth-context.js';
import { queryKnowledge, getDifyConfigSummary } from '../integrations/dify.js';
import { buildSkuContext, queryLocalAssistant } from '../lib/local-assistant.js';
import { checkAiRateLimit } from '../lib/ai-rate-limit.js';
import { requireMenu } from '../lib/rbac.js';
export const aiRoutes = new Hono();
aiRoutes.get('/ai/config', (c) => c.json(getDifyConfigSummary()));
aiRoutes.get('/ai/conversations', async (c) => {
    const user = await getCurrentUser(c);
    const rows = await db
        .select({
        id: kbConversations.id,
        title: kbConversations.title,
        createdAt: kbConversations.createdAt,
    })
        .from(kbConversations)
        .where(eq(kbConversations.userId, user.id))
        .orderBy(desc(kbConversations.createdAt))
        .limit(50);
    return c.json(rows);
});
aiRoutes.get('/ai/conversations/:id/messages', async (c) => {
    const user = await getCurrentUser(c);
    const convId = c.req.param('id');
    const [conv] = await db
        .select()
        .from(kbConversations)
        .where(and(eq(kbConversations.id, convId), eq(kbConversations.userId, user.id)))
        .limit(1);
    if (!conv)
        return c.json({ message: 'Conversation not found' }, 404);
    const messages = await db
        .select({
        id: kbMessages.id,
        role: kbMessages.role,
        content: kbMessages.content,
        sources: kbMessages.sources,
        createdAt: kbMessages.createdAt,
    })
        .from(kbMessages)
        .where(eq(kbMessages.conversationId, convId))
        .orderBy(kbMessages.createdAt);
    return c.json({ conversation: conv, messages });
});
aiRoutes.post('/ai/chat', requireMenu('ai.chat'), async (c) => {
    const user = await getCurrentUser(c);
    const rate = checkAiRateLimit(user.id);
    if (!rate.ok) {
        return c.json({ message: `Rate limit exceeded. Retry in ${rate.retryAfterSec}s` }, 429);
    }
    const body = await c.req.json();
    if (!body.query?.trim()) {
        return c.json({ message: 'query is required' }, 400);
    }
    let conversationId = body.conversationId;
    let difyConversationId;
    if (conversationId) {
        const [conv] = await db
            .select()
            .from(kbConversations)
            .where(and(eq(kbConversations.id, conversationId), eq(kbConversations.userId, user.id)))
            .limit(1);
        if (!conv)
            return c.json({ message: 'Conversation not found' }, 404);
        difyConversationId = conv.difyConversationId ?? undefined;
    }
    else {
        const [conv] = await db
            .insert(kbConversations)
            .values({
            userId: user.id,
            title: body.query.slice(0, 50),
        })
            .returning();
        conversationId = conv.id;
    }
    await db.insert(kbMessages).values({
        conversationId: conversationId,
        role: 'user',
        content: body.query,
    });
    const skuContext = await buildSkuContext({
        skuId: body.skuId,
        skuCode: body.skuCode,
        warehouseCode: body.warehouseCode,
    });
    const localContext = {
        skuId: body.skuId,
        skuCode: body.skuCode,
        warehouseCode: body.warehouseCode,
    };
    const difyConfig = getDifyConfigSummary();
    let answer;
    let sources;
    let mode = difyConfig.difyEnabled ? 'dify' : 'local';
    let fallback = false;
    try {
        if (difyConfig.difyEnabled) {
            try {
                const difyInputs = {};
                if (skuContext)
                    difyInputs.sku_context = skuContext;
                if (body.skuCode?.trim())
                    difyInputs.sku_code = body.skuCode.trim();
                if (body.warehouseCode?.trim())
                    difyInputs.warehouse_code = body.warehouseCode.trim();
                const result = await queryKnowledge(body.query, user.id, {
                    conversationId: difyConversationId,
                    inputs: difyInputs,
                });
                answer = result.answer;
                sources = result.sources;
                if (result.conversationId && !difyConversationId) {
                    await db
                        .update(kbConversations)
                        .set({ difyConversationId: result.conversationId })
                        .where(eq(kbConversations.id, conversationId));
                }
            }
            catch (difyErr) {
                console.warn('[ai] Dify chat failed, falling back to local assistant:', difyErr);
                const local = await queryLocalAssistant(body.query, localContext);
                answer = `${local.answer}\n\n（Dify 知识库暂不可用，已切换本地助手）`;
                sources = local.sources;
                mode = 'local-fallback';
                fallback = true;
            }
        }
        else {
            const local = await queryLocalAssistant(body.query, localContext);
            answer = local.answer;
            sources = local.sources;
        }
        await db.insert(kbMessages).values({
            conversationId: conversationId,
            role: 'assistant',
            content: answer,
            sources: sources ?? null,
        });
        return c.json({
            answer,
            conversationId,
            sources,
            mode,
            fallback,
            difyEnabled: difyConfig.difyEnabled,
        });
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'AI request failed';
        return c.json({ message }, 502);
    }
});
