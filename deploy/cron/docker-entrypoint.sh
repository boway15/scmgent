#!/bin/sh
set -eu

if [ "${CRON_ENABLED:-true}" = "false" ] || [ "${CRON_ENABLED:-true}" = "0" ]; then
  echo "[cron] CRON_ENABLED=${CRON_ENABLED}; sleeping (scheduler idle)"
  exec sleep infinity
fi

if [ -z "${CRON_SECRET:-}" ]; then
  echo "[cron] CRON_SECRET missing; sleeping to avoid crash-loop" >&2
  exec sleep infinity
fi

echo "[cron] starting supercronic TZ=${TZ:-UTC} base=${CRON_BASE_URL:-http://web:8081}"
# 不要 exec：supercronic 作 PID 1 时 process reaper 在部分环境会 Fatal fork exec
supercronic /crontab
