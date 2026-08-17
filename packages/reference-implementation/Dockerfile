# syntax=docker.io/docker/dockerfile:1

FROM node:22.22.2-alpine AS base
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
COPY packages/untp-utils/package.json ./packages/untp-utils/

# Install RI's tree (RI itself + its transitive workspace deps:
# components, services) plus their non-workspace dependencies. The
# filter is the load-bearing optimisation here: untp-utils, untp-playground,
# untp-test-suite, cypress (root devDep), turbo, storybook, etc. do not
# get fetched into the image because nothing in RI's tree depends on them.
#
# A previous version used a separate `pnpm fetch` step ahead of install.
# Removed because pnpm 9's `pnpm fetch` ignores `--filter` (pnpm#4407,
# fixed in pnpm 10) and was prefetching the entire lockfile into the
# layer including cypress. The BuildKit cache mount on the pnpm store
# still preserves downloaded tarballs across rebuilds.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile --filter "untp-reference-implementation..."

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
#   2. untp-utils — stable, no in-repo deps
#   3. services   — depends on untp-utils, changes more often
#   4. reference-implementation — the app, changes the most
COPY packages/components/. ./packages/components/
RUN pnpm --filter @reference-implementation/components run build

COPY packages/untp-utils/. ./packages/untp-utils/
RUN pnpm --filter @uncefact/untp-utils run build

COPY packages/services/. ./packages/services/
RUN pnpm --filter @uncefact/untp-ri-services run build

COPY packages/reference-implementation/. ./packages/reference-implementation/
RUN pnpm --filter untp-reference-implementation run build

# ---- Production-only install ----
# pnpm deploy emits a flattened node_modules with only RI's production
# dependency closure (including the linked workspace packages it imports).
# This replaces the previous "yarn --production" pass.
FROM builder AS runtime-deps
WORKDIR /app
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm deploy --filter untp-reference-implementation --prod /deploy

# pnpm deploy alone is not enough to recover the size win from PR #618.
# The workspace package @reference-implementation/components legitimately
# declares MUI, lucide-react, tailwindcss, and @tailwindcss/postcss as its
# own runtime deps, and the deploy walks them in. Next.js standalone
# already bundles everything reachable at runtime into
# .next/standalone/node_modules, so those copies under /deploy/node_modules
# are dead weight at runtime; strip them. The remaining entries (next,
# next-auth, @auth, next-swagger-doc, swagger-ui-react, @swagger-api,
# html5-qrcode, sanitize-html, tw-animate-css, @vercel) should not be
# present after the RI devDeps reclassification, but are listed defensively
# in case one is re-promoted accidentally; the rm is a no-op for those
# until/unless that happens.
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

# Lay down the entrypoint-only node_modules first (from pnpm deploy). This
# stage contributes the prisma CLI, tsx, dotenv, jose, and the other deps
# the docker-entrypoint.sh scripts pull in (prisma migrate deploy, then
# tsx seed.ts). Next.js standalone's tracer does not include these
# because the server itself never imports them.
COPY --from=runtime-deps --chown=nextjs:nodejs /deploy/node_modules ./node_modules

# Next.js standalone output goes on top so that any package present in
# both trees (react, react-dom, @prisma/client, @uncefact/untp-ri-services,
# the workspace components package, etc.) is served from the exact files
# the standalone tracer captured. The pnpm-deploy isolated-layout
# symlinks would otherwise route imports back through .pnpm/, which is
# fragile against the rm hack in the runtime-deps stage. outputFileTracingRoot
# is pinned to the monorepo root so server.js lands at
# packages/reference-implementation/server.js.
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/static ./packages/reference-implementation/.next/static

COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/prisma ./prisma

# Modules required by prisma/seed.ts (relative imports from ../src/lib/...)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/prisma/constants.ts ./src/lib/prisma/constants.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/prisma/generated ./src/lib/prisma/generated
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/prisma/prisma.ts ./src/lib/prisma/prisma.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/config ./src/lib/config
# Modules required by prisma/custom-seed.ts (conformity-scheme ingestion path)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/api/logger.ts ./src/lib/api/logger.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/credentials/schema-loader.ts ./src/lib/credentials/schema-loader.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/credentials/context-cache.ts ./src/lib/credentials/context-cache.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/cvc ./src/lib/cvc
# Modules required by prisma/seed.ts and scripts/backfill-decryption-keys.ts
# (encryption-key resolution and decryption-key protection; relative imports)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/encryption ./src/lib/encryption
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/prisma/database-url.ts ./src/lib/prisma/database-url.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/credentials/decryption-key-protection.ts ./src/lib/credentials/decryption-key-protection.ts
# Encryption key startup validation, required by prisma/seed.ts (#762)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/credentials/validate-encryption-key-startup.ts ./src/lib/credentials/validate-encryption-key-startup.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/credentials/backfill-decryption-keys.ts ./src/lib/credentials/backfill-decryption-keys.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/credentials/rotate-encryption-key.ts ./src/lib/credentials/rotate-encryption-key.ts
# Read-only encryption audit and shared envelope-store iteration, required by
# scripts/audit-encryption.ts and (via the preflight) the backfill (#764)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/credentials/audit-encryption.ts ./src/lib/credentials/audit-encryption.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/credentials/envelope-stores.ts ./src/lib/credentials/envelope-stores.ts
# Operator-run maintenance scripts (run via node_modules/.bin/tsx; see each
# script's header for the in-image invocation)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/scripts ./scripts
# Render templates used by prisma/seed.ts
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/templates ./src/templates

# Declare ./src as ESM so tsx interprets imported .ts files (constants.ts,
# did.config.ts, etc.) as ESM and their named exports bind cleanly when
# the ESM-scoped prisma/seed.ts imports them. Without this, tsx walks up
# from ./src/lib/prisma/constants.ts to the next ancestor without a
# "type" field and treats the file as CJS — ESM-side named imports then
# fail with "module does not provide an export named …". The Prisma
# generated client under src/lib/prisma/generated/ keeps its own
# package.json (no "type" field), so it remains CJS as Prisma expects.
RUN echo '{"type":"module"}' > ./src/package.json

COPY --chown=nextjs:nodejs packages/reference-implementation/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

USER nextjs

EXPOSE 3003

ENV PORT=3003
ENV HOSTNAME="0.0.0.0"

# Probe 127.0.0.1, not localhost. HOSTNAME above makes the server listen on IPv4
# only, while BusyBox wget resolves localhost to ::1 first, so a localhost probe
# never connects.
#
# The start period is a courtesy for an empty or small database, not a coverage
# guarantee. The entrypoint's migrate, backfill and seed steps run before the
# server listens and their duration grows with the credential and render
# template tables, so any deployment with real data should widen start-period
# and retries with a compose or orchestrator override.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
  CMD wget --quiet --spider http://127.0.0.1:3003/api/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "packages/reference-implementation/server.js"]

# ---- E2E target (same image, kept as a named stage for docker-compose.e2e.yml) ----
FROM build AS development
