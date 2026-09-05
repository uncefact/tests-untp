#!/bin/sh
# The worker container's entrypoint (#985). The image's entrypoint runs schema
# convergence (migrations, backfills, seed) before it execs its arguments and
# reads the SKIP_* flags to decide, so they have to be set before it runs; a
# wrapper supplied as the command would run too late. This script replaces the
# entrypoint, exports the flags, and hands over to the shared entrypoint so
# RI_DATABASE_URL is still constructed there. The web container owns
# migrations; SKIP_MIGRATIONS also skips the backfills nested inside it.
# The image's CMD (the web server) would otherwise be appended to the exec
# line as arguments, so this script names the whole command itself.
set -eu
export SKIP_MIGRATIONS=true
export SKIP_SEED=true
exec /app/docker-entrypoint.sh node --import tsx src/worker/main.ts
