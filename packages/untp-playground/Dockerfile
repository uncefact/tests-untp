# syntax=docker.io/docker/dockerfile:1

FROM node:20.12.2-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable

# ---- Fetch + install (deps stage) ----
# Workspace-aware install scoped to the playground via pnpm filter. The
# playground has no workspace cross-deps, so the filter effectively
# resolves only its own dependency tree.
FROM base AS deps
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY packages/untp-playground/package.json ./packages/untp-playground/

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm fetch --frozen-lockfile --filter "untp-playground..."

RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm install --frozen-lockfile --offline --filter "untp-playground..."

# ---- Builder ----
FROM deps AS builder
WORKDIR /app

COPY packages/untp-playground/. ./packages/untp-playground/

ARG NEXT_PUBLIC_BASE_PATH
ARG NEXT_PUBLIC_ASSET_PREFIX
ARG NEXT_PUBLIC_IMAGE_PATH
ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_ASSET_PREFIX=${NEXT_PUBLIC_ASSET_PREFIX}
ENV NEXT_PUBLIC_IMAGE_PATH=${NEXT_PUBLIC_IMAGE_PATH}

RUN pnpm --filter untp-playground run build

# ---- Runtime image ----
# Next.js standalone output is fully self-contained for the playground:
# no prisma, no seed.ts, no runtime entrypoint scripts. So we copy only
# the standalone output and skip a separate runtime node_modules entirely.
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/untp-playground/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/packages/untp-playground/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/untp-playground/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "packages/untp-playground/server.js"]
