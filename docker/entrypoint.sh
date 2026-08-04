#!/bin/sh
set -e

echo "[entrypoint] Waiting for PostgreSQL..."
until pg_isready -h "${DB_HOST:-postgres}" -U "${DB_USER:-scm}" -d "${DB_NAME:-scm_dev}" > /dev/null 2>&1; do
  sleep 1
done
echo "[entrypoint] PostgreSQL is ready."

if [ -z "${FEISHU_BITABLE_PROCUREMENT_APP_TOKEN:-}${FEISHU_BITABLE_APP_TOKEN:-}" ] || [ -z "${FEISHU_BITABLE_TABLE_INVENTORY:-}" ]; then
  echo "[entrypoint] WARN: Feishu inventory turnover bitable not fully configured (need app token + FEISHU_BITABLE_TABLE_INVENTORY)."
else
  echo "[entrypoint] Feishu inventory turnover bitable configured (table=${FEISHU_BITABLE_TABLE_INVENTORY})."
fi

echo "[entrypoint] Running migrations..."
cd /app/packages/db
pnpm exec drizzle-kit migrate

echo "[entrypoint] Seeding database (idempotent)..."
pnpm exec tsx src/seed.ts || true

echo "[entrypoint] Starting web server on port ${PORT:-8081}..."
cd /app/apps/web
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=4096}"
exec pnpm exec tsx server/index.ts
