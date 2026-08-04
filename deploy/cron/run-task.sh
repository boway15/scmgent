#!/bin/sh
set -eu

path="${1:?usage: run-task.sh /api/tasks/...}"
base="${CRON_BASE_URL:-http://web:8081}"
base="${base%/}"
url="${base}${path}"

if [ -z "${CRON_SECRET:-}" ]; then
  echo "[cron] CRON_SECRET is empty; refusing to call ${url}" >&2
  exit 1
fi

echo "[cron] $(date -Iseconds) POST ${url}"
curl -fsS -X POST \
  -H "X-Cron-Secret: ${CRON_SECRET}" \
  -H "Accept: application/json" \
  --connect-timeout 30 \
  --max-time 3600 \
  "${url}"
echo
echo "[cron] $(date -Iseconds) OK ${path}"
