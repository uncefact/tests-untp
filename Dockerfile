# ---- Base Node ----
FROM node:18 AS base
WORKDIR /app
COPY package*.json yarn.lock ./

# ---- Dependencies ----
FROM base AS dependencies
COPY . .
RUN yarn install && yarn cache clean
ARG APP_CONFIG
RUN cp $APP_CONFIG packages/mock-app/src/constants/app-config.json

# ---- Build ----
FROM dependencies AS build
RUN yarn build

# ---- Nginx ----
FROM nginx:stable-alpine AS release
COPY --from=build /app/packages/mock-app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]