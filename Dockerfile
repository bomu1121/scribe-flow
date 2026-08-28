# ScribeFlow 单容器部署：后端 API + 前端 dist + ffmpeg
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile \
  && pnpm --filter @scribe-flow/web build \
  && pnpm --filter @scribe-flow/server build

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data \
    STATIC_DIR=/app/apps/web/dist \
    MAX_UPLOAD_MB=2048

VOLUME ["/data"]
EXPOSE 8787

CMD ["pnpm", "--filter", "@scribe-flow/server", "exec", "tsx", "src/index.ts"]
