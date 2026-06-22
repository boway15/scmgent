/**
 * Dify integration — Chat RAG + Workflow API.
 * API keys stay server-side only; unset keys keep local algorithm / FAQ paths.
 */
const DIFY_BASE_URL = (process.env.DIFY_BASE_URL ?? 'http://localhost:8080/v1').replace(/\/$/, '');
const WORKFLOW_TIMEOUT_MS = Number(process.env.DIFY_WORKFLOW_TIMEOUT_MS ?? 120_000);
/** True when env var is set and not a documented placeholder. */
export function isDifyKeyConfigured(envName) {
    const value = process.env[envName]?.trim();
    if (!value)
        return false;
    const placeholders = new Set(['app-', 'app-xxxx', 'app-xxx', 'app-yyyy', 'app-zzzz']);
    return !placeholders.has(value);
}
export function isDifyEnabled() {
    return isDifyKeyConfigured('DIFY_API_KEY_KNOWLEDGE');
}
export function isReplenishmentWorkflowEnabled() {
    return isDifyKeyConfigured('DIFY_API_KEY_REPLENISHMENT');
}
export function isAlertWorkflowEnabled() {
    return isDifyKeyConfigured('DIFY_API_KEY_ALERT');
}
export function getDifyConfigSummary() {
    return {
        mode: isDifyEnabled() ? 'dify' : 'local',
        difyEnabled: isDifyEnabled(),
        replenishmentWorkflow: isReplenishmentWorkflowEnabled(),
        alertWorkflow: isAlertWorkflowEnabled(),
        baseUrl: DIFY_BASE_URL,
    };
}
function normalizeSources(resources) {
    if (!resources?.length)
        return undefined;
    return resources.map((r) => ({
        document_name: r.document_name,
        content: r.content,
    }));
}
export async function queryKnowledge(query, userId, options) {
    if (!isDifyEnabled()) {
        throw new Error('Dify knowledge API is not configured');
    }
    const apiKey = process.env.DIFY_API_KEY_KNOWLEDGE;
    const inputs = options?.inputs ?? {};
    const res = await fetch(`${DIFY_BASE_URL}/chat-messages`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            inputs,
            query,
            response_mode: 'blocking',
            conversation_id: options?.conversationId,
            user: userId,
        }),
        signal: AbortSignal.timeout(WORKFLOW_TIMEOUT_MS),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Dify API error ${res.status}: ${text}`);
    }
    const data = (await res.json());
    return {
        answer: data.answer,
        conversationId: data.conversation_id,
        sources: normalizeSources(data.metadata?.retriever_resources),
    };
}
export async function runWorkflow(apiKeyEnv, inputs, userId = 'system-task') {
    if (!isDifyKeyConfigured(apiKeyEnv)) {
        throw new Error(`${apiKeyEnv} is not configured`);
    }
    const apiKey = process.env[apiKeyEnv];
    const res = await fetch(`${DIFY_BASE_URL}/workflows/run`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            inputs,
            response_mode: 'blocking',
            user: userId,
        }),
        signal: AbortSignal.timeout(WORKFLOW_TIMEOUT_MS),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Dify workflow error ${res.status}: ${text}`);
    }
    const data = (await res.json());
    return data.data?.outputs ?? {};
}
