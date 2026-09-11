#!/bin/sh
# The worker container's entrypoint (#985). The image's entrypoint runs schema
# convergence (migrations, backfills, seed) before it execs its arguments and
# reads the SKIP_* flags before it runs; a wrapper supplied as the command
# would run too late. This script replaces the entrypoint, exports the flags,
# and hands over to the shared entrypoint with an explicit worker marker as its
# first argument. The shared entrypoint consumes that marker, runs the worker
# preflight and constructs RI_DATABASE_URL there. The web container owns
# migrations; SKIP_MIGRATIONS also skips the backfills nested inside it.
# The image's CMD (the web server) would otherwise be appended to the exec
# line as arguments, so this script names the whole command itself.
set -eu
export SKIP_MIGRATIONS=true
export SKIP_SEED=true
exec /app/docker-entrypoint.sh --process-role=worker node --import tsx src/worker/main.ts
