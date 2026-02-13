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

# Copy prisma files and node_modules for running migrations and seeding at runtime
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

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
