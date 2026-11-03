# Built from the monorepo root: docker build -f apps/web/Dockerfile .
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/audio/package.json packages/audio/package.json
# better-sqlite3 needs a toolchain to build its native binding
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# Persistent pnpm package cache across builds: when this layer does re-run, packages
# come from the cache instead of the network.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --store-dir /pnpm-store

FROM deps AS build
COPY . .
RUN pnpm --filter @podstudio/web run build

FROM node:24-slim AS runtime
# ffmpeg decodes a published MP3 once to draw the public player's waveform (cached afterwards)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
ENV NODE_ENV=production
ENV PODSTUDIO_DB_PATH=/data/podstudio.db
EXPOSE 3000
WORKDIR /repo/apps/web
RUN chmod +x docker-entrypoint.sh
CMD ["./docker-entrypoint.sh"]
