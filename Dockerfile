# ---- Base Node ----
FROM node:21 AS base
WORKDIR /app
COPY package*.json yarn.lock ./

# ---- Dependencies ----
FROM base AS dependencies
COPY . .
RUN yarn install && yarn cache clean

# ---- Build ----
FROM dependencies AS build
RUN yarn build

ARG CONFIG_FILE
COPY ${CONFIG_FILE} packages/mock-app/src/constants/app-config.json
WORKDIR /app/packages/mock-app
RUN yarn build

# ---- Nginx ----
FROM nginx:stable-alpine AS release
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/mock-app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]