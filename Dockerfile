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

COPY ${CONFIG_FILE} packages/mock-app/src/constants/app-config.json
COPY ${CONFIG_FILE} packages/components/src/constants/app-config.json

WORKDIR /app/packages/mock-app

# Rebuild mock-app for standalone output
RUN yarn build

# Copy static assets to standalone output
RUN cp -r .next/static .next/standalone/packages/mock-app/.next/static
RUN cp -r public .next/standalone/packages/mock-app/public 2>/dev/null || true

# Copy prisma files to standalone for migrations
RUN cp -r prisma .next/standalone/packages/mock-app/prisma

EXPOSE 3003

# Run prisma migrate from original location, then start standalone server
CMD ["sh", "-c", "cd /app/packages/mock-app && npx prisma migrate deploy --config=prisma/prisma.config.ts && npx prisma db seed && cd .next/standalone/packages/mock-app && PORT=3003 node server.js"]