---
sidebar_position: 5
title: Encryption Audit
---

# Encryption Audit

The Reference Implementation encrypts two kinds of data at rest under `DATA_ENCRYPTION_KEY`: service instance configurations and credential decryption keys. Startup validation decrypts a single sampled envelope, so a mixed-key database, or rows corrupted after that check, can pass boot and only surface when a request happens to touch an affected row. The `audit:encryption` command answers the question exhaustively: it attempts to decrypt every stored envelope under the active key and reports the result per store, without writing anything.

Run it:

- before rotating `DATA_ENCRYPTION_KEY`, to confirm the current key decrypts everything the rotation will re-encrypt (key rotation itself is tracked in [#720](https://github.com/uncefact/tests-untp/issues/720));
- after restoring a database backup, to confirm the restored data and the configured key still match;
- during incident triage, when decryption errors suggest a key or data problem and you need the full extent rather than the one row a request tripped over.

## Running the audit

From a source checkout, in `packages/reference-implementation`:

```bash
pnpm audit:encryption
```

Inside the published Docker image (which ships no pnpm):

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/audit-encryption.ts
```

The command needs `DATA_ENCRYPTION_KEY` and a database target: a pre-set `RI_DATABASE_URL` is honoured as given, and the `RI_POSTGRES_*` variables are used to construct one only when it is absent (the same rule the application and the backfill follow).

## Reading the report

For each store the audit prints how many values decrypted cleanly, then the ids of any rows that failed to decrypt (a valid envelope that will not open, meaning a key mismatch or corruption of the envelope's ciphertext, IV, or authentication tag) and of any rows holding corrupted values (data that is not a valid envelope at all). Service instance configurations are always written encrypted, so any non-envelope value there is corruption. Credential keys can legitimately predate encryption at rest, so only values that look like a damaged envelope are flagged; other plain values are counted as legacy plaintext.

The audit doubles as the dry run for the [decryption-key backfill](../../migration-guides/ri-v0.4#decryption-key-backfill-for-existing-credentials): it reports how many legacy plaintext keys a backfill run would wrap, notes any corrupted-looking credential rows a backfill would skip untouched, and states when a backfill would refuse to run without `--force` because no stored envelope proves the key. When the audit finds decrypt failures or corrupted service instance configurations, a backfill run aborts before writing anything, and `--force` does not change that; resolve those rows first.

When the database holds nothing encrypted (a fresh deployment, or only legacy plaintext keys), the audit says so explicitly: a clean result in that state means nothing failed, not that the key was proven able to decrypt anything.

## Exit codes

- `0`: the audit completed and every stored envelope decrypted cleanly (including the nothing-to-verify case, which is stated in the output).
- `1`: the audit found decrypt failures or corrupted rows, or it could not complete (for example, the database was unreachable). The output distinguishes the two.

## Concurrent writes

The audit reads in id order with cursor pagination and no transaction, so it is a point-in-time report: a row changed after it was scanned, or inserted behind the scan position, is not re-examined. When the result gates a rotation or a restore, stop application writers first and keep them stopped until the follow-up action is done. A run against a live system is fine for triage; re-run it quiesced before acting on the result.
