# Setup the environment
FROM node:22.22.2-alpine
RUN corepack enable

WORKDIR /app

# Set the environment variables
ENV DOCS_PORT=3002 \
    DOCS_URL=http://0.0.0.0 \
    DOCS_BASE_URL=/

# The development server writes .docusaurus and node_modules/.cache under /app,
# so the runtime user owns /app and installs the dependencies itself. When
# docker-compose.yml bind-mounts ./documentation over /app, that host directory
# must be writable by uid 1000, and a documentation/.docusaurus left behind by
# an earlier image that ran as root must be removed once.
RUN chown node:node /app

USER node

# Install the dependencies. --ignore-workspace prevents pnpm from walking
# up to the monorepo root's pnpm-workspace.yaml; the docs site is a
# self-contained Docusaurus project, not a workspace member. The store cache
# is owned by the node user, under its own id so a root-owned store from an
# earlier build is not reused.
COPY --chown=node:node package.json pnpm-lock.yaml ./

RUN --mount=type=cache,id=pnpm-store-docs-node,target=/pnpm-store,sharing=locked,uid=1000,gid=1000 \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --ignore-workspace --frozen-lockfile

# Copy the documentation site files
COPY --chown=node:node . .

# Expose the port the documentation site will run on
EXPOSE ${DOCS_PORT}

# Probe 127.0.0.1, not localhost, because BusyBox wget resolves localhost to
# ::1 first. The development server compiles the site before it answers, so
# the start period allows for a cold build.
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=120s \
  CMD wget --quiet --spider "http://127.0.0.1:${DOCS_PORT}${DOCS_BASE_URL}" || exit 1

# Start the documentation site
CMD pnpm start --port ${DOCS_PORT} --host 0.0.0.0
