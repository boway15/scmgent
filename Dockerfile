FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
WORKDIR /app

# 先复制依赖清单，利用 Docker 层缓存：仅 lockfile / package.json 变更时才重装
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/db/package.json ./packages/db/
RUN --mount=type=cache,id=scm-pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .

FROM deps AS build
RUN pnpm --filter @scm/web build

FROM node:20-alpine AS runner
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate
RUN apk add --no-cache postgresql-client
WORKDIR /app

COPY --from=build /app /app
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV SERVE_STATIC=true
ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
