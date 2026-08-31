---
sidebar_position: 4
title: Credential Details
---

# Credential Details Backfill

Reads stored credentials that predate descriptive-field capture and writes the library-facing name, issuer, subject, and validity columns, plus the spec version the matching data-model bridge was resolved with.

This is an **operator-run** backfill. It ships in the image but never runs on its own, because it fetches every tenant's stored artefact. A wrong details write is not itself destructive to the stored credential, but the fetch is an external side effect, and the window during which existing rows sit at `EXTRACTION_PENDING` should stay short.

Credentials issued after descriptive-field capture already carry these columns. Until this job has run, pre-existing rows remain readable and verifiable; only their stored summary is missing.

## Before running it

The descriptive-column migration must already have been applied. Run this job immediately after that migration deploys, so existing rows do not sit at `EXTRACTION_PENDING` indefinitely.

Take a database backup first. The job does not rewrite the stored credential, but it does update every matching row's details columns.

Run a dry run before the write pass, so you can review which rows would change and which would fail.

```bash
pnpm backfill:credential-details -- --dry-run
```

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-credential-details.ts --dry-run
```

A dry run performs the same per-row fetch, decrypt, and decode work as a live pass. It writes nothing.

## Running it

From a source checkout, in `packages/reference-implementation`:

```bash
pnpm backfill:credential-details
```

The published Docker image carries no package manifest for the Reference Implementation, so inside the image run the script directly:

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-credential-details.ts
```

It needs a database target. A pre-set `RI_DATABASE_URL` is honoured as given, and the `RI_POSTGRES_*` variables are used to construct one only when it is absent, which is the same rule the application follows.

If a row holds an encrypted artefact, `DATA_ENCRYPTION_KEY` must match the key the application uses to unwrap the stored decryption key.

## What it reports

A completed run reports how many rows it scanned, how many it updated (or would update, in a dry run), and how many failed (or would fail). Every failed row is listed by record id, error class, and message.

Three error classes:

- **UNREADABLE_ENVELOPE.** The storage URI could not be fetched, or the body was not valid JSON, or the artefact was not a decodable enveloped credential. Check that the storage service is reachable and that the object at that URI is intact. After the artefact can be read, set that row's `detailsStatus` back to `EXTRACTION_PENDING` and re-run.
- **DECRYPT_FAILED.** The stored decryption key could not unwrap the artefact, or the at-rest key envelope could not be opened. Confirm `DATA_ENCRYPTION_KEY` matches the running application, and that the row's key is the one that stored the artefact. After the key is restored, set `detailsStatus` back to `EXTRACTION_PENDING` and re-run.
- **BRIDGE_ERROR.** No unique registered bridge version matched the credential's `@context`, or a stored `coreDataModelVersion` has no bridge, or the extractor threw. Do not guess a version. After a code fix (for example a newly registered bridge), set `detailsStatus` back to `EXTRACTION_PENDING` and re-run.

A run that finishes its work with no failures exits 0. It exits 1 when any row failed, so an automated caller notices.

One failed row does not abort the batch. Every other row is still attempted, and the failed row is marked `EXTRACTION_FAILED` rather than left pending.

## Re-running

Re-running is safe and converges. Rows already `EXTRACTED` or `EXTRACTION_FAILED` are not selected. A second run over a fully backfilled table reports zero rows changed.

Failed rows stay failed until you reset them to `EXTRACTION_PENDING`. That is deliberate: a retry must be an operator decision after the cause is understood, not an automatic re-derivation.
