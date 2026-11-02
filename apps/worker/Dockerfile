# Built from the monorepo root: docker build -f apps/worker/Dockerfile .
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/audio/package.json packages/audio/package.json
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Persistent pnpm package cache across builds: when this layer does re-run, packages
# come from the cache instead of the network.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

FROM deps AS runtime
# ffmpeg/ffprobe decode uploaded audio into the project format (Stage 04 imports)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY . .
ENV NODE_ENV=production
ENV PODSTUDIO_DB_PATH=/data/podstudio.db
WORKDIR /repo/apps/worker
CMD ["pnpm", "exec", "tsx", "src/index.ts"]
