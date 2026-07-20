# Setup the environment
FROM node:22.22.2-alpine
RUN corepack enable

WORKDIR /app

# Set the environment variables
ENV DOCS_PORT=3002 \
    DOCS_URL=http://0.0.0.0 \
    DOCS_BASE_URL=/

# Install the dependencies. --ignore-workspace prevents pnpm from walking
# up to the monorepo root's pnpm-workspace.yaml; the docs site is a
# self-contained Docusaurus project, not a workspace member.
COPY package.json pnpm-lock.yaml ./

RUN --mount=type=cache,id=pnpm-store-docs,target=/pnpm-store,sharing=locked \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --ignore-workspace --frozen-lockfile

# Copy the documentation site files
COPY . .

# Expose the port the documentation site will run on
EXPOSE ${DOCS_PORT}

# Start the documentation site
CMD pnpm start --port ${DOCS_PORT} --host 0.0.0.0
