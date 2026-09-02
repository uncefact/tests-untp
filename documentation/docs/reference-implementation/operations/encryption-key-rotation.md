---
sidebar_position: 8
title: Encryption Key Rotation
---

# Encryption Key Rotation

The Reference Implementation [encrypts service instance configurations, credential decryption keys and idempotent-retry response bodies at rest](../services/service-architecture#encryption-at-rest) under `DATA_ENCRYPTION_KEY`. Each stored envelope opens only under the key that wrote it, so changing the variable in place makes existing data unreadable. The `rotate:encryption-key` command moves the data instead: given the previous key, it re-encrypts every stored envelope under the new active key.

The command is idempotent. A re-run with the same key pair finds rows already on the new key and leaves them alone, so a run interrupted partway is completed by running it again.

## Before you start

1. Back up the database, and keep both key values somewhere safe until the rotation is verified. A backup without its matching key is not a recovery artefact; see [Key Management and Recovery](./key-management#backups-pair-with-the-key) for the pairing and retention rules.
2. Run [`audit:encryption`](./encryption-audit) under the current key and resolve any findings. The rotation refuses to write when a service instance configuration or a credential key fails to decrypt under both supplied keys, or a service configuration is corrupted. Findings against idempotent-retry response bodies are the exception: they are expected leftovers until a rotation clears them, and they do not stop the run.
3. Stop every application instance, including replicas and any maintenance jobs. The rotation must be the only thing touching the database. Run it as a one-off process (for Docker deployments, `docker compose run --rm`), never by `exec`-ing into a serving container.

## Running the rotation

Set both keys in `.env`: `DATA_ENCRYPTION_KEY` becomes the **new** key (its end state anyway, and an accidental application start before the rotation has written anything then fails loudly at startup validation), and `OUTGOING_DATA_ENCRYPTION_KEY` holds the **previous** key for the duration of the rotation. Compose forwards both to the rotation container; the serving application never reads the outgoing variable, and it is removed before the application starts. Make sure none of the key variables are exported in your shell: the shell environment takes precedence over `.env` for both compose and the source-checkout scripts, so a stale exported value would silently win over what you just wrote to `.env`.

From a source checkout, in `packages/reference-implementation`:

```bash
pnpm rotate:encryption-key
```

The published Docker image carries no package manifest for the Reference Implementation, so inside the image run the script directly:

```bash
docker compose run --rm \
  -e SKIP_MIGRATIONS=true -e SKIP_SEED=true \
  ri node_modules/.bin/tsx scripts/rotate-encryption-key.ts
```

Both keys arrive from `.env` like every other variable. The two `SKIP_` variables stop the image's entrypoint running migrations and the database seed before the command: the seed validates `DATA_ENCRYPTION_KEY` against existing encrypted data, which fails by design while the database is still under the old key. Skipping both keeps the rotation the only thing touching the database.

The command needs a database target: a pre-set `RI_DATABASE_URL` is honoured as given, and the `RI_POSTGRES_*` variables are used to construct one only when it is absent (the same rule the application, audit, and backfill follow).

The new key must not be the placeholder value published in `.env.example`: outside local development the command refuses it, the same as application startup does. A placeholder **outgoing** key only warns, because rotating off the published value is exactly the remediation it exists for.

## Reading the report

For each store the report shows how many envelopes were already under the active key, how many opened only under the outgoing key, how many were rotated, and the ids of anything else: envelopes neither key opened, corrupted service configurations (both abort the run before any write, except in the idempotent-retry response bodies, where such rows are cleared, the claim and its credential kept, and the run continues, because the application already answers a retry without that body), corrupted-looking credential rows the rotation leaves untouched, rows deleted or changed while the run was in flight, and legacy plaintext credential keys (which belong to [`backfill:decryption-keys`](./backfills/decryption-keys), run under the new key).

When a valid envelope opens under neither key, the report shows both decrypt errors for the first such row. A wrong third key and tampered data produce the same error, so the report does not claim which it is.

If the report says the outgoing key opened nothing and everything already opens under the active key, nothing was rotated. After a completed rotation that is the expected re-run result; on a first run it usually means the two variables are reversed.

Exit codes: `0` when every stored envelope ended under the active key; `1` when the run was blocked before writing, finished incomplete (suspect, changed, or deleted rows to inspect), or could not complete. The output distinguishes these.

## After the rotation

1. With writers still stopped, run the [stopped-writers audit](./encryption-audit#running-with-the-application-stopped) with `DATA_ENCRYPTION_KEY` set to the new key. Success means no decrypt failures and no new corruption (a response body the rotation cleared no longer appears); credential rows the rotation reported as corrupted-looking will still be flagged, and they match the rotation's report. Do not continue to startup while the audit shows decrypt failures or new corruption.
2. Remove `OUTGOING_DATA_ENCRYPTION_KEY` from `.env`, and if the deployment still sets the deprecated `SERVICE_ENCRYPTION_KEY` alias, set it to the new key or remove it. Both must happen before the application starts: containers capture their environment when created, so a variable removed from `.env` afterwards lives on in the running container until it is recreated (and startup fails while the alias names disagree).
3. Start the application and confirm a credential read and a service resolution work. Retire the old key only per the [retention rule](./key-management#backups-pair-with-the-key): retained backups taken while it was active still open only under it.

If the rotation failed partway, keep every writer stopped, fix what the report names, and re-run with the same key pair; the run converges. Do not start the application against a partially rotated database: the sampled startup check can pass on a row under one key while requests fail on rows under the other.
