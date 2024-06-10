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

# Build aguments
ARG CONFIG_FILE=app-config.template.json
ARG CONFORMITY_CREDENTIALS_URL=http://example.com
ARG CONFORMITY_STORED_CREDENTIALS_URL=http://localhost:3333/v1/credentials
ARG CONFORMITY_STORED_CREDENTIALS_BUCKET=verifiable-credentials
ARG CONFORMITY_UPLOAD_CREDENTIALS_URL=http://localhost:3333/v1/credentials
ARG CONFORMITY_UPLOAD_CREDENTIALS_BUCKET=verifiable-credentials
ARG DLR_API_URL=http://localhost:8080
ARG VCKIT_API_URL=http://localhost:3332/v1
ARG DLR_API_KEY=5555555555555
ARG STORAGE_API_URL=http://localhost:3333/v1/credentials
ARG STORAGE_BUCKET=epcis-events
ARG RESULT_PATH_URI=/uri
ARG VCKIT_ISSUER=did:web:example.com
ARG DLR_VERIFICATION_PAGE=http://localhost:3000/verify
ARG IDENTIFY_PROVIDER_URL=http://localhost:3334
# Build environment variables
ENV CONFORMITY_CREDENTIALS_URL=${CONFORMITY_CREDENTIALS_URL}
ENV CONFORMITY_STORED_CREDENTIALS_URL=${CONFORMITY_STORED_CREDENTIALS_URL}
ENV CONFORMITY_STORED_CREDENTIALS_BUCKET=${CONFORMITY_STORED_CREDENTIALS_BUCKET}
ENV CONFORMITY_UPLOAD_CREDENTIALS_URL=${CONFORMITY_UPLOAD_CREDENTIALS_URL}
ENV CONFORMITY_UPLOAD_CREDENTIALS_BUCKET=${CONFORMITY_UPLOAD_CREDENTIALS_BUCKET}
ENV DLR_API_URL=${DLR_API_URL}
ENV VCKIT_API_URL=${VCKIT_API_URL}
ENV DLR_API_KEY=${DLR_API_KEY}
ENV STORAGE_API_URL=${STORAGE_API_URL}
ENV STORAGE_BUCKET=${STORAGE_BUCKET}
ENV RESULT_PATH_URI=${RESULT_PATH_URI}
ENV VCKIT_ISSUER=${VCKIT_ISSUER}
ENV DLR_VERIFICATION_PAGE=${DLR_VERIFICATION_PAGE}
ENV IDENTIFY_PROVIDER_URL=${IDENTIFY_PROVIDER_URL}

# Add and run the entrypoint script to the image
RUN apt update && apt install gettext -y
COPY ${CONFIG_FILE} .
COPY entrypoint.sh .
RUN chmod +x entrypoint.sh
RUN ./entrypoint.sh

WORKDIR /app/packages/mock-app
RUN yarn build

# ---- Nginx ----
FROM nginx:stable-alpine AS release
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/mock-app/build /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
