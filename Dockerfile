# ---- Base ----
FROM node:20.12.2-alpine AS base

# ---- Dependencies ----
FROM base AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Copy only package manifests and lockfile for dependency installation
COPY package.json yarn.lock ./
COPY packages/reference-implementation/package.json ./packages/reference-implementation/
COPY packages/components/package.json ./packages/components/
COPY packages/services/package.json ./packages/services/
COPY digitallink_toolkit_server ./digitallink_toolkit_server/
RUN yarn install --frozen-lockfile

# ---- Builder ----
FROM base AS builder
WORKDIR /app

# Copy installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/reference-implementation/node_modules ./packages/reference-implementation/node_modules
COPY --from=deps /app/packages/components/node_modules ./packages/components/node_modules
COPY --from=deps /app/packages/services/node_modules ./packages/services/node_modules

# Copy source code for only the required packages
COPY package.json ./
COPY packages/reference-implementation/. ./packages/reference-implementation/
COPY packages/components/. ./packages/components/
COPY packages/services/. ./packages/services/
COPY digitallink_toolkit_server ./digitallink_toolkit_server/

# Inject app-config (excluded by .dockerignore, so must be copied via build arg)
ARG CONFIG_FILE=./app-config.json
COPY ${CONFIG_FILE} ./packages/reference-implementation/src/constants/app-config.json
COPY ${CONFIG_FILE} ./packages/components/src/constants/app-config.json

# Build workspace dependencies in order: services -> components -> reference-implementation
# Cache mounts persist the Next.js build cache across Docker builds so only
# changed modules are recompiled, even when source COPY layers invalidate.
WORKDIR /app/packages/services
RUN yarn run build

WORKDIR /app/packages/components
RUN yarn run build

WORKDIR /app/packages/reference-implementation
RUN yarn run build

# ---- Runtime ----
# "build" target: used by package.yml for published image
# "development" target: used by docker-compose.e2e.yml for E2E tests
FROM base AS build
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/reference-implementation/public ./public

# Copy standalone output from Next.js build
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/static ./.next/static

# Copy prisma schema + migrations for running migrations at runtime
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/prisma ./prisma

# Runtime node_modules — only packages needed for prisma migrate + tsx seed.
# The Next.js standalone output (copied above) already bundles all server
# dependencies via output tracing. These are the additional packages not
# included in that trace (~170 MB vs ~1.8 GB for the full monorepo install).
#
# prisma CLI + engines
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
# prisma config loading chain (c12 + transitive deps)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/c12 ./node_modules/c12
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/confbox ./node_modules/confbox
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/defu ./node_modules/defu
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/jiti ./node_modules/jiti
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/ohash ./node_modules/ohash
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pathe ./node_modules/pathe
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pkg-types ./node_modules/pkg-types
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/rc9 ./node_modules/rc9
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/destr ./node_modules/destr
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/exsolve ./node_modules/exsolve
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/citty ./node_modules/citty
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/consola ./node_modules/consola
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/giget ./node_modules/giget
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/node-fetch-native ./node_modules/node-fetch-native
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/nypm ./node_modules/nypm
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/tinyexec ./node_modules/tinyexec
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/perfect-debounce ./node_modules/perfect-debounce
# chokidar (file watching — nested inside c12, but some deps hoisted)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/chokidar ./node_modules/chokidar
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/readdirp ./node_modules/readdirp
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/braces ./node_modules/braces
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/fill-range ./node_modules/fill-range
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/to-regex-range ./node_modules/to-regex-range
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/is-number ./node_modules/is-number
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/picomatch ./node_modules/picomatch
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/glob-parent ./node_modules/glob-parent
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/is-glob ./node_modules/is-glob
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/is-extglob ./node_modules/is-extglob
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/anymatch ./node_modules/anymatch
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/normalize-path ./node_modules/normalize-path
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/binary-extensions ./node_modules/binary-extensions
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/is-binary-path ./node_modules/is-binary-path
# other prisma transitive deps
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/dotenv ./node_modules/dotenv
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/effect ./node_modules/effect
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@standard-schema ./node_modules/@standard-schema
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/deepmerge-ts ./node_modules/deepmerge-ts
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/empathic ./node_modules/empathic
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/fast-check ./node_modules/fast-check
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/pure-rand ./node_modules/pure-rand
# tsx + esbuild (for seed script)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/tsx ./node_modules/tsx
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/esbuild ./node_modules/esbuild
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/@esbuild ./node_modules/@esbuild
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/get-tsconfig ./node_modules/get-tsconfig
COPY --from=deps --chown=nextjs:nodejs /app/node_modules/resolve-pkg-maps ./node_modules/resolve-pkg-maps

# Copy modules required by prisma/seed.ts
# Relative imports (../src/lib/...)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/prisma/generated ./src/lib/prisma/generated
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/lib/config ./src/lib/config
# @uncefact/untp-ri-services (workspace symlink in node_modules points here)
COPY --from=builder --chown=nextjs:nodejs /app/packages/services/build ./packages/services/build
COPY --from=builder --chown=nextjs:nodejs /app/packages/services/package.json ./packages/services/package.json

# Copy built-in config files for fallback (when no runtime config is mounted)
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/src/constants/app-config*.json ./src/constants/

# Copy and set up entrypoint script
COPY --chown=nextjs:nodejs packages/reference-implementation/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create config directory for runtime configuration
RUN mkdir -p /app/config && chown nextjs:nodejs /app/config

USER nextjs

EXPOSE 3003

ENV PORT=3003
ENV HOSTNAME="0.0.0.0"

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "server.js"]

# ---- E2E target (runs seed before server; migrations already handled by entrypoint) ----
FROM build AS development
CMD ["sh", "-c", "cd /app/prisma && npx tsx seed.ts && cd /app && node server.js"]
