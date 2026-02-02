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

EXPOSE 3003

CMD ["sh", "-c", "npx prisma migrate deploy --config=prisma/prisma.config.ts && yarn dev"]