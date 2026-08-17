---
sidebar_position: 3
title: Decryption Keys
---

# Decryption Keys Backfill

Wraps credential decryption keys that are still stored in plaintext into encrypted envelopes under `DATA_ENCRYPTION_KEY`.

This is an **operator-run** backfill. It ships in the image but never runs on its own, because wrapping keys under the wrong `DATA_ENCRYPTION_KEY` produces values nobody can unwrap. A human confirms the key and takes a backup first.

Credentials issued before keys were encrypted at rest keep working without it: the read path still recognises a legacy plaintext key. Until it has run, encryption at rest covers only newly issued credentials.

## Before running it

1. Preview what it would do with the read-only [encryption audit](../encryption-audit), which decrypts every stored envelope under the active key and reports what this backfill would wrap, skip, or abort on.
2. Back up the database, and record which key the backup pairs with (see [Key Management and Recovery](../key-management#backups-pair-with-the-key)).
3. Confirm `DATA_ENCRYPTION_KEY` is exactly the key the running application uses.
4. Stop older application instances that might still write plaintext keys during a rolling upgrade. Alternatively, plan to run it again once they are gone, which is safe and converges.

## Running it

From a source checkout, in `packages/reference-implementation`:

```bash
pnpm backfill:decryption-keys
```

The published Docker image carries no package manifest for the Reference Implementation, so inside the image run the script directly:

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-decryption-keys.ts
```

It needs `DATA_ENCRYPTION_KEY` and a database target. A pre-set `RI_DATABASE_URL` is honoured as given, and the `RI_POSTGRES_*` variables are used to construct one only when it is absent, which is the same rule the application follows.

## How it protects itself

Before writing anything, the run decrypts every encrypted value it can find, both credential keys and service instance configurations, and aborts on any failure, naming every row that could not be read. A wrong key therefore ends as a refusal rather than as damage.

Where nothing stored can prove the key and there are plaintext keys waiting to be wrapped, the run refuses rather than guessing. Both halves matter: a database with nothing to wrap completes without `--force`, because there is no risky write to gate. `--force` accepts the risk explicitly, and is only appropriate once you have verified the key out of band and hold a backup:

```bash
pnpm backfill:decryption-keys -- --force
```

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-decryption-keys.ts --force
```

`--force` covers only that one case. It does not bypass a failed decryption: a run whose preflight cannot read an existing envelope aborts whether or not the flag is passed.

## What it reports

A completed run reports how many keys it wrapped and how many were already protected. Three cases get called out individually:

- **Suspect rows.** A stored value that resembles a corrupted envelope is skipped rather than treated as plaintext and wrapped again. These rows are listed by id for manual inspection, and the run exits non-zero so an automated caller notices.
- **Rows deleted mid-run.** A credential removed while the backfill was working is skipped and reported, which is a benign race rather than a failure.
- **An unproven key.** Whenever a run completes without an envelope to verify the key against, whether it wrapped rows under `--force` or had nothing to wrap, it says so and asks you to confirm a wrapped key decrypts correctly.

After a run, confirm a wrapped key still round-trips by retrieving a credential through the API (`GET /api/v1/credentials/{id}`) and checking its decryption key behaves as before.

A run that finishes its work exits 0, including one that reported deleted rows or proceeded under `--force`. It exits 1 when it skipped suspect rows, when it refused an unproven key, when the preflight could not decrypt something, and when a write failed.

## Re-running

Re-running is safe and converges. Rows already holding an envelope are counted as already protected and left untouched. After a rolling upgrade has drained the old writers, the second run therefore only picks up what those writers added.

## Rolling back afterwards

Once any encrypted key has been written, whether by a newly issued credential or by this backfill, rolling back to an application version without an unwrap step returns the raw envelope JSON in place of those decryption keys. Treat the upgrade as forward-only once credentials have been issued, or restore the database backup that pairs with the key.
