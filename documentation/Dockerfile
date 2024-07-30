# Setup the environment
FROM node:20-alpine

WORKDIR /app

# Set the environment variables
ENV PORT=3002 \
    DOCS_URL=http://0.0.0.0 \
    DOCS_BASE_URL=/

# Install the dependencies
COPY package.json yarn.lock ./

RUN yarn install --frozen-lockfile

# Build the documentation site
COPY . .

RUN yarn run build

# Expose the port the documentation site will run on
EXPOSE ${PORT}

# Serve the documentation site
CMD yarn serve --port $PORT --host 0.0.0.0


