# syntax=docker.io/docker/dockerfile:1

FROM node:20.12.2-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install dependencies based on the preferred package manager
COPY package.json yarn.lock ./
COPY packages/mock-app/package.json ./packages/mock-app/
COPY packages/components/package.json ./packages/components/
COPY packages/services/package.json ./packages/services/
COPY digitallink_toolkit_server ./digitallink_toolkit_server/
RUN yarn install --frozen-lockfile

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/mock-app/node_modules ./packages/mock-app/node_modules
COPY --from=deps /app/packages/components/node_modules ./packages/components/node_modules
COPY --from=deps /app/packages/services/node_modules ./packages/services/node_modules
COPY package.json ./
COPY packages/mock-app/. ./packages/mock-app/
COPY packages/components/. ./packages/components/
COPY packages/services/. ./packages/services/
COPY digitallink_toolkit_server ./digitallink_toolkit_server/

# Copy app-config.json from root to expected locations (excluded by .dockerignore)
ARG CONFIG_FILE=./app-config.json
COPY ${CONFIG_FILE} ./packages/mock-app/src/constants/app-config.json
COPY ${CONFIG_FILE} ./packages/components/src/constants/app-config.json

# Recreate workspace symlinks after copying source files
WORKDIR /app
RUN yarn install --frozen-lockfile

# Build workspace dependencies in order: services -> components -> mock-app
WORKDIR /app/packages/services
RUN yarn run build

WORKDIR /app/packages/components
RUN yarn run build

WORKDIR /app/packages/mock-app
RUN yarn run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/packages/mock-app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/packages/mock-app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/mock-app/.next/static ./.next/static

# Copy prisma files and node_modules for running migrations at runtime
COPY --from=builder --chown=nextjs:nodejs /app/packages/mock-app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules

# Copy built-in config files for fallback (when no runtime config is mounted)
COPY --from=builder --chown=nextjs:nodejs /app/packages/mock-app/src/constants/app-config*.json ./src/constants/

# Copy and set up entrypoint script
COPY --chown=nextjs:nodejs packages/mock-app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

# Create config directory for runtime configuration
RUN mkdir -p /app/config && chown nextjs:nodejs /app/config

USER nextjs

EXPOSE 3003

ENV PORT=3003

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
ENV HOSTNAME="0.0.0.0"
ENTRYPOINT ["./docker-entrypoint.sh"]
