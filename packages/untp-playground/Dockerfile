# syntax=docker.io/docker/dockerfile:1

FROM node:20.12.2-alpine AS base

# Install dependencies only when needed
FROM base AS deps
# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
WORKDIR /app

ENV NEXT_PUBLIC_BASE_PATH=/
ENV NEXT_PUBLIC_ASSET_PREFIX=/

# Install dependencies based on the preferred package manager
# Set up proper workspace structure
COPY package.json yarn.lock ./
COPY packages/untp-playground/package.json ./packages/untp-playground/
COPY packages/untp-test-suite-mocha/package.json ./packages/untp-test-suite-mocha/
COPY packages/untp-test-suite-mocha/src ./packages/untp-test-suite-mocha/src/
COPY packages/untp-test-suite-mocha/scripts ./packages/untp-test-suite-mocha/scripts/
COPY packages/untp-test-suite-mocha/untp-tests ./packages/untp-test-suite-mocha/untp-tests/
COPY packages/untp-test-suite-mocha/tsconfig.json ./packages/untp-test-suite-mocha/

# Install from root to resolve workspace dependencies
RUN yarn install --immutable

# Build the workspace dependency
WORKDIR /app/packages/untp-test-suite-mocha
RUN yarn run build
WORKDIR /app



# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
# Copy hoisted node_modules from workspace root
COPY --from=deps /app/node_modules ./node_modules
# Copy package-specific node_modules if they exist
COPY --from=deps /app/packages/untp-playground/node_modules ./packages/untp-playground/node_modules
# Copy the complete built workspace dependency (preserves relative imports)
COPY --from=deps /app/packages/untp-test-suite-mocha ./node_modules/untp-test-suite-mocha
COPY packages/untp-playground/. .

# Add build args without defaults
ARG NEXT_PUBLIC_BASE_PATH
ARG NEXT_PUBLIC_ASSET_PREFIX
ARG NEXT_PUBLIC_IMAGE_PATH
ARG NEXT_PUBLIC_VERIFICATION_SERVICE_URL
ARG NEXT_PUBLIC_VERIFICATION_SERVICE_TOKEN

ENV NEXT_PUBLIC_BASE_PATH=${NEXT_PUBLIC_BASE_PATH}
ENV NEXT_PUBLIC_ASSET_PREFIX=${NEXT_PUBLIC_ASSET_PREFIX}
ENV NEXT_PUBLIC_IMAGE_PATH=${NEXT_PUBLIC_IMAGE_PATH}
ENV NEXT_PUBLIC_VERIFICATION_SERVICE_URL=${NEXT_PUBLIC_VERIFICATION_SERVICE_URL}
ENV NEXT_PUBLIC_VERIFICATION_SERVICE_TOKEN=${NEXT_PUBLIC_VERIFICATION_SERVICE_TOKEN}

RUN yarn run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
# Uncomment the following line in case you want to disable telemetry during runtime.
# ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
ENV HOSTNAME="0.0.0.0"
CMD ["node", "server.js"]