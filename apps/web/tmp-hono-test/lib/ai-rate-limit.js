const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;
const buckets = new Map();
export function checkAiRateLimit(userId) {
    const now = Date.now();
    const bucket = buckets.get(userId);
    if (!bucket || now >= bucket.resetAt) {
        buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
        return { ok: true };
    }
    if (bucket.count >= MAX_PER_WINDOW) {
        return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000) };
    }
    bucket.count += 1;
    return { ok: true };
}
