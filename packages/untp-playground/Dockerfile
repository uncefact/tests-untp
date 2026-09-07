# syntax=docker.io/docker/dockerfile:1

FROM node:22.22.2-alpine AS base
RUN apk add --no-cache libc6-compat
RUN corepack enable

# ---- Fetch + install (deps stage) ----
# Workspace-aware install scoped to the playground via pnpm filter. The
# playground depends on the @uncefact/untp-utils workspace package (guarded
# fetch + SSRF guard), so its manifest is copied too and the `...` filter
# pulls it and its dependencies into the install.
FROM base AS deps
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY packages/untp-playground/package.json ./packages/untp-playground/
COPY packages/untp-utils/package.json ./packages/untp-utils/

# Install the playground's tree only. The filter keeps the rest of the
# workspace (RI, services, components, cypress, turbo, storybook, etc.)
# out of the image. The BuildKit cache mount on the pnpm store keeps
# downloads warm across rebuilds.
#
# A previous version used `pnpm fetch` ahead of install. Removed because
# pnpm 9's fetch ignores --filter (pnpm#4407, fixed in pnpm 10) and was
# pulling cypress and the rest of the lockfile into the image.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile --filter "untp-playground..."

# ---- Builder ----
FROM deps AS builder
WORKDIR /app

# Build the untp-utils workspace dependency before the playground. It compiles
# to `build/` (which .dockerignore keeps out of the build context) and its
# package `exports` point at those compiled files, so `next build` needs them
# present to resolve the `@uncefact/untp-utils/{cache,loaders}` imports (and
# the resolver and guard graph they pull in transitively).
# `next build` then bundles that import graph into the route chunk, so the
# standalone runner self-contains it with no separate utils/undici tree.
COPY packages/untp-utils/. ./packages/untp-utils/
RUN pnpm --filter @uncefact/untp-utils run build

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

COPY --from=builder /app/packages/untp-playground/public ./packages/untp-playground/public
COPY --from=builder --chown=nextjs:nodejs /app/packages/untp-playground/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/packages/untp-playground/.next/static ./packages/untp-playground/.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "packages/untp-playground/server.js"]
