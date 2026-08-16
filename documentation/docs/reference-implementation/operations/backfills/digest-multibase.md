---
sidebar_position: 2
title: Digest Multibase
---

# Digest Multibase Backfill

Converts the stored digest on credentials and render templates from the legacy hexadecimal form to the multibase encoding the application now writes.

This is an **automatic** backfill. It runs by default on every container start, as [step 2 of the startup sequence](../startup#step-2-data-backfills), so a Docker deployment normally needs no action. It is safe to repeat, never re-fetches content from storage, and never changes storage URLs, so external references to a credential or render template stay stable.

## What it does

For each credential and render template row, it looks at the stored digest:

| Stored value | Action |
|--------------|--------|
| Already a multibase digest | Skipped |
| A legacy hexadecimal digest of the expected length | Rewritten as a multibase encoding of the same digest bytes |
| Anything else | Left as it is, with a warning naming the row |

The conversion keeps the digest bytes exactly as they were and only changes how they are encoded, which is why it can run unattended: the value can be decoded back to the same bytes from what is stored, without the credential content or any secret.

## Running it manually

Running the application on the host does not go through the container entrypoint, so the conversion does not happen on its own. Apply the database migrations first, then run it once from `packages/reference-implementation`. The `--env-file` flag points it at the root `.env` for the database connection:

```bash
pnpm exec tsx --env-file=../../.env prisma/backfills/2026-05-19-hex-to-multibase.ts
```

Inside the published Docker image it has normally already run at start. To run it again there, note that unlike the other maintenance scripts it does not build a database connection string from the `RI_POSTGRES_*` variables, so it needs the entrypoint to do that for it. Run it as a one-off container, the same way the [encryption audit](../encryption-audit#running-with-the-application-stopped) does, with the skip variables stopping the entrypoint's own migration and seed work first:

```bash
docker compose run --rm \
  -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
  ri node_modules/.bin/tsx prisma/backfills/2026-05-19-hex-to-multibase.ts
```

Running it with `docker compose exec` against the already-started container does not work on its own, because the entrypoint builds `RI_DATABASE_URL` in the container's first process and an `exec` does not inherit it.

A deployment that applies migrations out of band with `SKIP_MIGRATIONS=true` skips this backfill too, because it runs inside the same guard. Run it with one of the commands above as part of that same out-of-band step.

## What it reports

Each table is reported as a count of rows scanned, transcoded, skipped, and unrecognised, the last of which the log calls `unknown`. Those are the rows to look at: each is warned about individually with its id and the value that could not be read as either format.

A completed scan exits 0, including when it warned about unrecognised rows, and a scan that throws exits 1. So the exit status tells you whether the run finished, not whether every row converted. Read the warnings to find rows that need attention.

## Re-running and failure

Re-running is expected and safe. The second run recognises the values the first one converted and skips them, so the counts move from transcoded to skipped and nothing is rewritten.

A failure stops the container start. The entrypoint halts at the first failing step, so the seed does not run and the application does not start, while rows converted before the failure stay converted. Restarting scans again and skips what was already done. Where a persistent failure is blocking a boot and you need the instance up, `SKIP_BACKFILLS=true` starts it with the old values still in place. Those rows keep whatever format they held, and existing credentials continue to verify.

## Do you have to run it?

For continuity, no. Legacy hexadecimal digests keep working: the verify endpoint still accepts a hex value and the storage adapter handles it, so credentials and resolver links created before the upgrade continue to verify. What the conversion buys is that stored values match the format the current version writes and the API contract describes, which matters for consumers reading `digestMultibase` directly.
