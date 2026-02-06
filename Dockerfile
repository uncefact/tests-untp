# ---- Base Node ----
FROM node:20.12.2 AS base

WORKDIR /app

COPY package*.json yarn.lock ./

# ---- Dependencies ----
FROM base AS dependencies

# TODO: Only copy packages needed in the image
COPY . .

RUN yarn install --frozen-lockfile

RUN yarn build

# ---- Development ----
FROM dependencies AS development

ARG CONFIG_FILE

COPY ${CONFIG_FILE} packages/reference-implementation/src/constants/app-config.json
COPY ${CONFIG_FILE} packages/components/src/constants/app-config.json

WORKDIR /app/packages/reference-implementation

# Rebuild reference-implementation for standalone output
RUN yarn build

# Copy static assets to standalone output
RUN cp -r .next/static .next/standalone/packages/reference-implementation/.next/static
RUN cp -r public .next/standalone/packages/reference-implementation/public 2>/dev/null || true

# Copy prisma files to standalone for migrations
RUN cp -r prisma .next/standalone/packages/reference-implementation/prisma

EXPOSE 3003

# Run prisma migrate from original location, then start standalone server
CMD ["sh", "-c", "cd /app/packages/reference-implementation && npx prisma migrate deploy --config=prisma/prisma.config.ts && cd .next/standalone/packages/reference-implementation && PORT=3003 node server.js"]
