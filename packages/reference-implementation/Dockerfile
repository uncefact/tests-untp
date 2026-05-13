# syntax=docker.io/docker/dockerfile:1

FROM node:20.12.2-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable

# ---- Fetch + install (deps stage) ----
# This stage prepares a workspace with all dependencies installed. It is
# cached on the package.json + lockfile fingerprint, so any source-only
# change goes straight to the builder stage with the install layer intact.
FROM base AS deps
WORKDIR /app

# Lockfile + workspace metadata is the cache key for the install layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY packages/reference-implementation/package.json ./packages/reference-implementation/
COPY packages/components/package.json ./packages/components/
COPY packages/services/package.json ./packages/services/

# pnpm fetch populates the virtual store from the lockfile. Sharing the
# pnpm store via a BuildKit cache mount means repeat builds (and the
# runtime-deps stage in this same image) re-use the same tarballs.
# --filter scopes the fetch to RI and its transitive workspace deps
# (components, services); untp-utils, untp-playground and untp-test-suite
# aren't part of RI's runtime or build graph so their tarballs stay out
# of the cache layer.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm fetch --frozen-lockfile --filter "untp-reference-implementation..."

# Install resolves the workspace symlinks against the prefetched store.
# --offline skips network round-trips; everything is already on disk.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm install --frozen-lockfile --offline --filter "untp-reference-implementation..."

# ---- Builder ----
# Builds the four workspace packages in dependency order. Reuses the deps
# stage's installed node_modules; source changes only invalidate this
# stage and below.
FROM deps AS builder
WORKDIR /app

# Build packages in stable-to-volatile order. Interleaving COPY + build
# means a change to one package's source only invalidates that package's
# build layer and everything downstream, instead of busting the whole
# chain. Order:
#   1. components — most stable (UI primitives change infrequently)
#   2. services   — changes more often than components
#   3. reference-implementation — the app, changes the most
COPY packages/components/. ./packages/components/
RUN pnpm --filter @reference-implementation/components run build

COPY packages/services/. ./packages/services/
RUN pnpm --filter @uncefact/untp-ri-services run build

COPY packages/reference-implementation/. ./packages/reference-implementation/
RUN pnpm --filter untp-reference-implementation run build

# ---- Production-only install ----
# pnpm deploy emits a flattened node_modules with only RI's production
# dependencies (including the linked workspace packages it imports).
# This replaces both the previous "yarn --production" pass and the manual
# rm -rf of Next.js/UI trees: pnpm deploy already excludes anything not
# reachable from RI's runtime entrypoints.
FROM builder AS runtime-deps
WORKDIR /app
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm deploy --filter untp-reference-implementation --prod /deploy

# Even with the devDeps reclassification, pnpm deploy still pulls UI/Next
# trees in via the workspace `@reference-implementation/components` (which
# legitimately declares MUI, lucide-react, etc. as its own runtime deps).
# Next.js standalone already bundles everything reachable at runtime into
# .next/standalone/node_modules, so these copies under /deploy/node_modules
# are dead weight. Strip them to recover the ~700 MB win.
RUN rm -rf \
    /deploy/node_modules/next \
    /deploy/node_modules/@next \
    /deploy/node_modules/@mui \
    /deploy/node_modules/@swagger-api \
    /deploy/node_modules/swagger-ui-react \
    /deploy/node_modules/lucide-react \
    /deploy/node_modules/@tailwindcss \
    /deploy/node_modules/tailwindcss \
    /deploy/node_modules/sanitize-html \
    /deploy/node_modules/tw-animate-css \
    /deploy/node_modules/@auth \
    /deploy/node_modules/next-auth \
    /deploy/node_modules/next-swagger-doc \
    /deploy/node_modules/html5-qrcode \
    /deploy/node_modules/@vercel \
    /deploy/node_modules/.pnpm/next@* \
    /deploy/node_modules/.pnpm/@next* \
    /deploy/node_modules/.pnpm/@mui* \
    /deploy/node_modules/.pnpm/@swagger-api* \
    /deploy/node_modules/.pnpm/swagger-ui-react* \
    /deploy/node_modules/.pnpm/lucide-react* \
    /deploy/node_modules/.pnpm/@tailwindcss* \
    /deploy/node_modules/.pnpm/tailwindcss* \
    /deploy/node_modules/.pnpm/sanitize-html* \
    /deploy/node_modules/.pnpm/tw-animate-css* \
    /deploy/node_modules/.pnpm/@auth* \
    /deploy/node_modules/.pnpm/next-auth* \
    /deploy/node_modules/.pnpm/next-swagger-doc* \
    /deploy/node_modules/.pnpm/html5-qrcode* \
    /deploy/node_modules/.pnpm/@vercel*

# ---- Runtime image ----
FROM base AS build
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/reference-implementation/public ./packages/reference-implementation/public

# Next.js standalone output. outputFileTracingRoot is pinned to the monorepo
# root so server.js lands at packages/reference-implementation/server.js.
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/static ./packages/reference-implementation/.next/static

# Prisma artefacts + runtime node_modules from the deploy stage. The deploy
# output already excludes devDependencies and unreachable runtime deps.
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/prisma ./prisma
COPY --from=runtime-deps --chown=nextjs:nodejs /deploy/node_modules ./node_modules

# Modules required by prisma/seed.ts (relative imports from ../src/lib/...)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/prisma/constants.ts ./src/lib/prisma/constants.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/prisma/generated ./src/lib/prisma/generated
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/config ./src/lib/config
# Render templates used by prisma/seed.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/templates ./src/templates

COPY --chown=nextjs:nodejs packages/reference-implementation/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3003

ENV PORT=3003
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "packages/reference-implementation/server.js"]

# ---- E2E target (same image, kept as a named stage for docker-compose.e2e.yml) ----
FROM build AS development
