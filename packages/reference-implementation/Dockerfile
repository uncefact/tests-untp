# syntax=docker.io/docker/dockerfile:1

FROM node:20.12.2-alpine AS base

# ---- Dependencies ----
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

COPY package.json yarn.lock ./
COPY packages/reference-implementation/package.json ./packages/reference-implementation/
COPY packages/components/package.json ./packages/components/
COPY packages/services/package.json ./packages/services/
# BuildKit cache mount persists yarn's tarball cache across CI runs (and
# across the deps + builder stages within the same run) via the GHA cache
# backend configured on the build job. When the layer above is invalidated
# (e.g. a single package.json edit), the install step still skips re-
# downloads and just relinks from the cache.
RUN --mount=type=cache,target=/yarn-cache,sharing=locked \
    yarn install --frozen-lockfile --network-timeout 600000 --cache-folder /yarn-cache

# ---- Runtime dependencies ----
# A second install pass that skips devDependencies. The output is used
# only in the final image to back the runtime entrypoint (prisma migrate,
# tsx-driven seed). We keep the dev-flavoured `deps` stage so the
# `builder` stage can still compile TypeScript, run `prisma generate`,
# etc., without pulling those tools into the runtime layer.
FROM base AS runtime-deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json yarn.lock ./
COPY packages/reference-implementation/package.json ./packages/reference-implementation/
COPY packages/components/package.json ./packages/components/
COPY packages/services/package.json ./packages/services/
# Production-only install. Shares the same /yarn-cache mount as the
# `deps` stage so the second install reuses tarballs from the first.
RUN --mount=type=cache,target=/yarn-cache,sharing=locked \
    yarn install --production --frozen-lockfile --network-timeout 600000 --cache-folder /yarn-cache

# Strip Next.js / UI runtime deps from the install. Next.js's standalone
# tracer (configured via `output: 'standalone'` in next.config.ts) bundles
# its own minimal node_modules INSIDE `.next/standalone/`, so the copies
# of `next`, `@next/*`, `@mui/*`, `swagger-ui-react`, `lucide-react`,
# `tailwindcss`, `next-auth`, `@auth/*`, etc. at `/app/node_modules` are
# redundant — the running server never reads them. They survive
# `yarn install --production` because they're declared as runtime
# `dependencies` (Next.js needs them at build time), but they're not
# reachable from the entrypoint scripts (`prisma migrate`, `tsx seed.ts`)
# or anything seed.ts transitively imports.
#
# Removing them drops the runtime node_modules from ~1.4 GB to ~250 MB.
# Verified against seed.ts's import graph: it only touches
# @uncefact/untp-ri-services (kept), dotenv (kept), @prisma/client
# (kept), and src/lib/* (no node_modules deps).
RUN rm -rf \
    node_modules/next \
    node_modules/@next \
    node_modules/@mui \
    node_modules/@swagger-api \
    node_modules/swagger-ui-react \
    node_modules/lucide-react \
    node_modules/@tailwindcss \
    node_modules/tailwindcss \
    node_modules/sanitize-html \
    node_modules/tw-animate-css \
    node_modules/@auth \
    node_modules/next-auth \
    node_modules/next-swagger-doc \
    node_modules/html5-qrcode \
    node_modules/@vercel

# ---- Builder ----
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/reference-implementation/node_modules ./packages/reference-implementation/node_modules
COPY --from=deps /app/packages/components/node_modules ./packages/components/node_modules
COPY --from=deps /app/packages/services/node_modules ./packages/services/node_modules

COPY package.json yarn.lock ./
COPY packages/reference-implementation/. ./packages/reference-implementation/
COPY packages/components/. ./packages/components/
COPY packages/services/. ./packages/services/
# Recreate workspace symlinks after copying source files. Same yarn-cache
# mount as the deps stage so any tarballs we couldn't link from the
# already-copied node_modules are pulled from the local cache rather than
# the network.
RUN --mount=type=cache,target=/yarn-cache,sharing=locked \
    yarn install --frozen-lockfile --network-timeout 600000 --cache-folder /yarn-cache

# Build workspace dependencies in order: services -> components -> reference-implementation
WORKDIR /app/packages/services
RUN yarn run build

WORKDIR /app/packages/components
RUN yarn run build

WORKDIR /app/packages/reference-implementation
RUN yarn run build

# ---- Runtime ----
FROM base AS build
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/reference-implementation/public ./packages/reference-implementation/public

# Copy standalone output from Next.js build. With outputFileTracingRoot pinned
# to the monorepo root, server.js is emitted at packages/reference-implementation/.
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/static ./packages/reference-implementation/.next/static

# Copy prisma files and node_modules for running migrations and seeding at runtime.
# node_modules comes from the `runtime-deps` stage (production-only install)
# rather than from `builder`, so the image excludes devDependencies (~1.5 GB
# of test tooling, build tools, storybook, etc.). The prisma CLI and tsx are
# declared in RI's `dependencies` for exactly this reason.
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/prisma ./prisma
COPY --from=runtime-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=runtime-deps --chown=nextjs:nodejs /app/packages/reference-implementation/node_modules ./packages/reference-implementation/node_modules

# Modules required by prisma/seed.ts (relative imports from ../src/lib/...)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/prisma/constants.ts ./src/lib/prisma/constants.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/prisma/generated ./src/lib/prisma/generated
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/config ./src/lib/config
# Render templates used by prisma/seed.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/templates ./src/templates
# @uncefact/untp-ri-services (workspace symlink in node_modules points here)
COPY --from=builder --chown=nextjs:nodejs /app/packages/services/build ./packages/services/build
COPY --from=builder --chown=nextjs:nodejs /app/packages/services/package.json ./packages/services/package.json

# Copy and set up entrypoint script
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
