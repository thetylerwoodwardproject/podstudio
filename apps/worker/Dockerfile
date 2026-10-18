# Built from the monorepo root: docker build -f apps/worker/Dockerfile .
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN pnpm install --frozen-lockfile

FROM deps AS runtime
COPY . .
ENV NODE_ENV=production
ENV PODSTUDIO_DB_PATH=/data/podstudio.db
WORKDIR /repo/apps/worker
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
