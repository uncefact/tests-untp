---
sidebar_position: 6
title: Encryption Audit
---

# Encryption Audit

The Reference Implementation [encrypts two kinds of data at rest](../services/service-architecture#encryption-at-rest) under `DATA_ENCRYPTION_KEY`: service instance configurations and credential decryption keys. Startup validation decrypts a single sampled envelope, so a mixed-key database, or rows corrupted after that check, can pass boot and only surface when a request happens to touch an affected row. The `audit:encryption` command answers the question exhaustively: it attempts to decrypt every stored envelope under the active key and reports the result per store, without writing anything.

Run it:

- before rotating `DATA_ENCRYPTION_KEY`, to confirm the current key decrypts everything the rotation will re-encrypt (see [Encryption Key Rotation](./encryption-key-rotation));
- after restoring a database backup, to confirm the restored data and the configured key still match (use the [stopped-writers form](#running-with-the-application-stopped) below, as the [recovery procedure](./key-management#recovery) directs);
- during incident triage, when decryption errors suggest a key or data problem and you need the full extent rather than the one row a request tripped over.

## Running the audit

From a source checkout, in `packages/reference-implementation`:

```bash
pnpm audit:encryption
```

The published Docker image carries no package manifest for the Reference Implementation, so inside the image run the script directly against the running application (live triage):

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/audit-encryption.ts
```

### Running with the application stopped

Before a [rotation](./encryption-key-rotation), after a [restore](./key-management#recovery), and in any state where writers must stay stopped, the audit runs as a one-off container instead. The key under test is whatever `DATA_ENCRYPTION_KEY` holds in `.env`, exactly as for the serving application, so the command needs no key arguments. The `SKIP_` variables stop the image's entrypoint running migrations, backfills, and the seed first, with `SKIP_MIGRATIONS=true` covering the backfills as well, because they run inside the same guard. The entrypoint otherwise writes to the database before the audit has gated anything, and against a database the configured key cannot yet read the seed's own key validation fails outright. The empty `SERVICE_ENCRYPTION_KEY` override neutralises a stale deprecated alias the compose file would otherwise forward (the audit refuses to run while the two names disagree):

```bash
docker compose run --rm \
  -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
  -e SERVICE_ENCRYPTION_KEY= \
  ri node_modules/.bin/tsx scripts/audit-encryption.ts
```

To audit under a key other than the one in `.env` (verifying a historical backup's key, for example), forward it for this one run by name-only `-e DATA_ENCRYPTION_KEY` with the value loaded from your secret store by command substitution (`DATA_ENCRYPTION_KEY="$(...)" docker compose run ... -e DATA_ENCRYPTION_KEY ...`); never type the literal key into the command, which records it in shell history.

On a source checkout, `pnpm audit:encryption` needs no entrypoint handling, but a stale `SERVICE_ENCRYPTION_KEY` must likewise be unset or overridden.

The command needs `DATA_ENCRYPTION_KEY` and a database target: a pre-set `RI_DATABASE_URL` is honoured as given, and the `RI_POSTGRES_*` variables are used to construct one only when it is absent (the same rule the application and the backfill follow).

## Reading the report

For each store the audit prints how many values decrypted cleanly, then the ids of any rows that failed to decrypt (a valid envelope that will not open, meaning a key mismatch or corruption of the envelope's ciphertext, IV, or authentication tag) and of any rows holding corrupted values (data that is not a valid envelope at all). Service instance configurations are always written encrypted, so any non-envelope value there is corruption. Credential keys can legitimately predate encryption at rest, so only values that look like a damaged envelope are flagged; other plain values are counted as legacy plaintext.

The audit doubles as the dry run for the [decryption-key backfill](./backfills/decryption-keys): it reports how many legacy plaintext keys a backfill run would wrap, notes any corrupted-looking credential rows a backfill would skip untouched, and states when a backfill would refuse to run without `--force` because no stored envelope proves the key. When the audit finds decrypt failures or corrupted service instance configurations, a backfill run aborts before writing anything, and `--force` does not change that; resolve those rows first.

When the database holds nothing encrypted (a fresh deployment, or only legacy plaintext keys), the audit says so explicitly: a clean result in that state means nothing failed, not that the key was proven able to decrypt anything.

## Exit codes

- `0`: the audit completed and every stored envelope decrypted cleanly (including the nothing-to-verify case, which is stated in the output).
- `1`: the audit found decrypt failures or corrupted rows, or it could not complete (for example, the database was unreachable). The output distinguishes the two.

## Concurrent writes

The audit reads in id order with cursor pagination and no transaction, so it is a point-in-time report: a row changed after it was scanned, or inserted behind the scan position, is not re-examined. When the result gates a rotation or a restore, stop application writers first and keep them stopped until the follow-up action is done. A run against a live system is fine for triage; re-run it quiesced before acting on the result.
