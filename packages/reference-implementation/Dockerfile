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
COPY digitallink_toolkit_server ./digitallink_toolkit_server/
RUN yarn install --frozen-lockfile --network-timeout 600000

# ---- Builder ----
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/reference-implementation/node_modules ./packages/reference-implementation/node_modules
COPY --from=deps /app/packages/components/node_modules ./packages/components/node_modules
COPY --from=deps /app/packages/services/node_modules ./packages/services/node_modules

COPY package.json ./
COPY packages/reference-implementation/. ./packages/reference-implementation/
COPY packages/components/. ./packages/components/
COPY packages/services/. ./packages/services/
COPY digitallink_toolkit_server ./digitallink_toolkit_server/

# Recreate workspace symlinks after copying source files
RUN yarn install --frozen-lockfile --network-timeout 600000

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

COPY --from=builder /app/packages/reference-implementation/public ./public

# Copy standalone output from Next.js build
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/.next/static ./.next/static

# Copy prisma files and node_modules for running migrations and seeding at runtime
COPY --from=builder --chown=nextjs:nodejs /app/packages/reference-implementation/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Modules required by prisma/seed.ts (relative imports from ../src/lib/...)
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
CMD ["node", "server.js"]

# ---- E2E target (same image, kept as a named stage for docker-compose.e2e.yml) ----
FROM build AS development
