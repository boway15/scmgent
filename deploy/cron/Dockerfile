FROM alpine:3.20

RUN apk add --no-cache curl ca-certificates tzdata

ARG TARGETARCH
ARG SUPERCRONIC_VERSION=v0.2.33
RUN case "${TARGETARCH}" in \
      amd64|"") ARCH=amd64 ;; \
      arm64) ARCH=arm64 ;; \
      *) echo "unsupported arch: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /usr/local/bin/supercronic \
      "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/supercronic-linux-${ARCH}" \
 && chmod +x /usr/local/bin/supercronic \
 && supercronic -version

COPY crontab /crontab
COPY run-task.sh /usr/local/bin/run-task.sh
COPY docker-entrypoint.sh /docker-entrypoint.sh
# Windows 检出可能带 CRLF，会导致 shebang「no such file or directory」
RUN sed -i 's/\r$//' /crontab /usr/local/bin/run-task.sh /docker-entrypoint.sh \
 && chmod +x /usr/local/bin/run-task.sh /docker-entrypoint.sh

ENV TZ=Asia/Shanghai \
    CRON_BASE_URL=http://web:8081 \
    CRON_ENABLED=true

ENTRYPOINT ["/docker-entrypoint.sh"]
