FROM node:20.12.2-alpine

# Install PostgreSQL client for database operations
RUN apk add --no-cache postgresql-client

WORKDIR /app

COPY package.json yarn.lock* ./

RUN yarn install --frozen-lockfile

COPY provision-env.ts schemas.ts config.json ./

COPY scripts/ /scripts/

# Make init script executable
RUN chmod +x /scripts/init.sh

CMD ["sh", "/scripts/init.sh"]
