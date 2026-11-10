-- 将既有下载任务有效期统一为创建时间 + 15 天（与 DOWNLOAD_TTL_DAYS 对齐）
UPDATE "download_jobs"
SET "expires_at" = "created_at" + INTERVAL '15 days'
WHERE "expires_at" < "created_at" + INTERVAL '15 days';
