import { eq, and, desc } from 'drizzle-orm';
import { db, kbConversations, kbMessages } from '@scm/db';

export async function listConversations(userId: string, limit = 50) {
  return db
    .select({
      id: kbConversations.id,
      title: kbConversations.title,
      createdAt: kbConversations.createdAt,
    })
    .from(kbConversations)
    .where(eq(kbConversations.userId, userId))
    .orderBy(desc(kbConversations.createdAt))
    .limit(limit);
}

export async function getConversationMessages(userId: string, conversationId: string) {
  const [conv] = await db
    .select()
    .from(kbConversations)
    .where(and(eq(kbConversations.id, conversationId), eq(kbConversations.userId, userId)))
    .limit(1);

  if (!conv) return null;

  const messages = await db
    .select({
      id: kbMessages.id,
      role: kbMessages.role,
      content: kbMessages.content,
      sources: kbMessages.sources,
      createdAt: kbMessages.createdAt,
    })
    .from(kbMessages)
    .where(eq(kbMessages.conversationId, conversationId))
    .orderBy(kbMessages.createdAt);

  return { conversation: conv, messages };
}

export async function ensureConversation(params: {
  userId: string;
  conversationId?: string;
  title: string;
}) {
  if (params.conversationId) {
    const [conv] = await db
      .select()
      .from(kbConversations)
      .where(
        and(eq(kbConversations.id, params.conversationId), eq(kbConversations.userId, params.userId)),
      )
      .limit(1);
    if (!conv) return null;
    return { conversationId: conv.id, difyConversationId: conv.difyConversationId ?? undefined };
  }

  const [conv] = await db
    .insert(kbConversations)
    .values({
      userId: params.userId,
      title: params.title.slice(0, 50),
    })
    .returning();

  return { conversationId: conv.id, difyConversationId: undefined };
}

export async function appendMessage(params: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: unknown[] | null;
}) {
  await db.insert(kbMessages).values({
    conversationId: params.conversationId,
    role: params.role,
    content: params.content,
    sources: params.sources ?? null,
  });
}

export async function updateDifyConversationId(conversationId: string, difyConversationId: string) {
  await db
    .update(kbConversations)
    .set({ difyConversationId })
    .where(eq(kbConversations.id, conversationId));
}
