---
sidebar_position: 6
title: Encryption Key Rotation
---

# Encryption Key Rotation

The Reference Implementation [encrypts service instance configurations and credential decryption keys at rest](../services/service-architecture#encryption-at-rest) under `DATA_ENCRYPTION_KEY`. Each stored envelope opens only under the key that wrote it, so changing the variable in place makes existing data unreadable. The `rotate:encryption-key` command moves the data instead: given the previous key, it re-encrypts every stored envelope under the new active key.

The command is idempotent. A re-run with the same key pair finds rows already on the new key and leaves them alone, so a run interrupted partway is completed by running it again.

## Before you start

1. Back up the database, and keep both key values somewhere safe until the rotation is verified. A backup without its matching key is not a recovery artefact.
2. Run [`audit:encryption`](./encryption-audit) under the current key and resolve any findings. The rotation refuses to write when any stored envelope fails to decrypt under both supplied keys, or any service configuration is corrupted.
3. Stop every application instance, including replicas and any maintenance jobs. The rotation must be the only thing touching the database. Run it as a one-off process (for Docker deployments, `docker compose run --rm`), never by `exec`-ing into a serving container.

## Running the rotation

Set `DATA_ENCRYPTION_KEY` to the **new** key and `OUTGOING_DATA_ENCRYPTION_KEY` to the **previous** key, in the rotation process only.

From a source checkout, in `packages/reference-implementation`:

```bash
pnpm rotate:encryption-key
```

Inside the published Docker image (which ships no pnpm):

Export both keys from your secret store first (name-only `-e` forwards the exported value without putting key material in shell history):

```bash
export DATA_ENCRYPTION_KEY='<new key>'
export OUTGOING_DATA_ENCRYPTION_KEY='<previous key>'
docker compose run --rm \
  -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
  -e DATA_ENCRYPTION_KEY -e OUTGOING_DATA_ENCRYPTION_KEY \
  ri node_modules/.bin/tsx scripts/rotate-encryption-key.ts
```

Every variable on the command matters. The compose file only forwards the variables it lists, and `OUTGOING_DATA_ENCRYPTION_KEY` is not among them, so both keys are passed to this one container explicitly (which also keeps the outgoing key out of the serving container's environment). The two `SKIP_` variables stop the image's entrypoint running migrations and the database seed before the command: the seed validates `DATA_ENCRYPTION_KEY` against existing encrypted data, which fails by design while the database is still under the old key. Skipping both keeps the rotation the only thing touching the database.

The command needs a database target: a pre-set `RI_DATABASE_URL` is honoured as given, and the `RI_POSTGRES_*` variables are used to construct one only when it is absent (the same rule the application, audit, and backfill follow).

The new key must not be the placeholder value published in `.env.example`: outside local development the command refuses it, the same as application startup does. A placeholder **outgoing** key only warns, because rotating off the published value is exactly the remediation it exists for.

## Reading the report

For each store the report shows how many envelopes were already under the active key, how many opened only under the outgoing key, how many were rotated, and the ids of anything else: envelopes neither key opened, corrupted service configurations (both abort the run before any write), corrupted-looking credential rows the rotation leaves untouched, rows deleted or changed while the run was in flight, and legacy plaintext credential keys (which belong to [`backfill:decryption-keys`](../../migration-guides/ri-v0.4#decryption-key-backfill-for-existing-credentials), run under the new key).

When a valid envelope opens under neither key, the report shows both decrypt errors for the first such row. A wrong third key and tampered data produce the same error, so the report does not claim which it is.

If the report says the outgoing key opened nothing and everything already opens under the active key, nothing was rotated. After a completed rotation that is the expected re-run result; on a first run it usually means the two variables are reversed.

Exit codes: `0` when every stored envelope ended under the active key; `1` when the run was blocked before writing, finished incomplete (suspect, changed, or deleted rows to inspect), or could not complete. The output distinguishes these.

## After the rotation

1. Run `audit:encryption` with `DATA_ENCRYPTION_KEY` set to the new key. With the application still stopped, the Docker form needs the same `SKIP_` pair, and an empty `SERVICE_ENCRYPTION_KEY` override when the deployment still carries that deprecated alias (compose forwards it, and the audit refuses to run while the two names disagree): `docker compose run --rm -e SKIP_MIGRATIONS=true -e SKIP_SEED=true -e DATA_ENCRYPTION_KEY -e SERVICE_ENCRYPTION_KEY= ri node_modules/.bin/tsx scripts/audit-encryption.ts`. On a source checkout, likewise make sure a stale `SERVICE_ENCRYPTION_KEY` is unset or overridden for this step. Success means no decrypt failures and no new corruption; credential rows the rotation reported as corrupted-looking will still be flagged, and they match the rotation's report.
2. If the deployment still sets the deprecated `SERVICE_ENCRYPTION_KEY` alias, set it to the new key or remove it before starting the application; startup fails when the two names disagree.
3. Start the application, confirm a credential read and a service resolution work, then remove `OUTGOING_DATA_ENCRYPTION_KEY` from the environment and retire the old key.

If the rotation failed partway, keep every writer stopped, fix what the report names, and re-run with the same key pair; the run converges. Do not start the application against a partially rotated database: the sampled startup check can pass on a row under one key while requests fail on rows under the other.
