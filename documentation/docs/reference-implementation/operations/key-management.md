---
sidebar_position: 6
title: Key Management and Recovery
---

# Key Management and Recovery

The Reference Implementation [encrypts service instance configurations, credential decryption keys, the keys of credentials registered from third parties and idempotent-retry response bodies at rest](../services/service-architecture#encryption-at-rest) under `DATA_ENCRYPTION_KEY`. This page is the operational contract for that key: how to generate and hold it, how backups pair with it, and how recovery works. The [Encryption Audit](./encryption-audit) and [Encryption Key Rotation](./encryption-key-rotation) pages own the two procedures this contract relies on.

## The key and what it protects

Generate the key with `openssl rand -hex 32`, producing the 64-character hexadecimal string the application requires. The placeholder value published in `.env.example` is for local development only; [startup validation](./startup#encryption-key-validation) enforces this, and that section defines exactly when a deployment counts as local development.

Every column the key protects is listed in one place in the code, and the audit, the rotation, the startup validation and the backfill's preflight all work from that list, so a column encrypted under the key is covered by every one of them or by none. Each such column is also marked in the database schema, and the build fails when a marked column is missing from the list or a listed column is unmarked.

## Uniqueness and storage

Each environment has one unique key, held in the deployment's secret store and never committed to version control. Every process and replica in an environment shares that one key; replicas configured with different values are a fault, not separate environments. The serving application resolves and caches exactly one active key. `SERVICE_ENCRYPTION_KEY` is a deprecated alias for the same value, not a second key, and startup fails when the two names disagree. The one exception is the offline [rotation command](./encryption-key-rotation), which deliberately reads a second variable while the application is stopped.

Keys do not travel between environments. Supplying a key other than a backup's paired one fails the audit exactly as key loss would (for any backup holding at least one encrypted envelope), and reusing one environment's key in another means new data is silently written under a key that does not belong there.

## Backups pair with the key

A database backup without its paired key is not a recovery artefact. Stored envelopes carry no key identifier, and the serving application holds exactly one active key, so losing the key makes every stored envelope permanently unreadable: every service instance configuration, every wrapped credential decryption key, whether the credential was issued here or registered from a third party, and every stored response body. Credential rows created before v0.4 keep their stored keys in plaintext until the [backfill](./backfills/decryption-keys) wraps them, so they, like credentials stored unencrypted, do not depend on the key and survive its loss.

For every backup, record which key opens it: the backup's identity (timestamp or version), its source environment, the secret-store version of the paired key, and, when a backup sits on one side of a [rotation](./encryption-key-rotation), which side. Also record the audit's suspect and corrupted row ids for that backup, so a later recovery can tell a pre-existing finding apart from new corruption. Record the secret-store reference, never the raw key, and keep raw key material out of logs and tickets.

Retire a key only when every retained backup taken under it has itself been retired. A completed rotation moves the live database to the new key; every retained backup still opens only under whichever key was active when it was taken, which after several rotations spans several key generations. A retired-too-early key turns those backups into dead weight even though the rotation succeeded. A recorded key is recoverable when its secret-store version can actually be retrieved; verify that periodically by retrieving it, rather than by decrypting something from every backup.

## Recovery

1. Stop every application instance, the background worker (`ri-worker` in the Compose stack) and every maintenance job. Nothing may write while recovery runs.
2. Restore the whole paired backup, using however this deployment restores PostgreSQL. Restore complete backups only: mixing rows from backups on different sides of a rotation creates a store split across keys, which the [audit](./encryption-audit) will surface and which the single-key application then fails on for every row under the other key.
3. Set `DATA_ENCRYPTION_KEY` to the backup's paired key, and set `SERVICE_ENCRYPTION_KEY` to the same value or unset it.
4. With writers still stopped, run the [stopped-writers audit](./encryption-audit#running-with-the-application-stopped) under that key, and gate on the report's content, never the exit code alone (pre-existing suspect credential rows already recorded for that backup exit 1 while being expected findings). The outcomes:
   - **Verified**: every envelope kind the backup is expected to contain decrypted, with no decrypt failures and no corruption beyond the rows already recorded for that backup. Continue.
   - **Clean but unproven**: the audit reports that nothing existed to verify the key against. On any backup expected to contain envelopes (encrypted service configurations or wrapped credential keys), that means the wrong backup or an incomplete restore; do not start the application. Only when the backup genuinely predates any encrypted data may you continue, recording that the key was not proven.
   - **Unproven with recorded findings only**: no envelope decrypted and the only findings are the suspect rows already recorded for that backup (the audit exits 1 in this state). Treat it as clean-but-unproven: continue only when the backup genuinely predates any encrypted data, recording that the key was not proven.
   - **Failed**: decrypt failures or corruption in service instance configurations, credential keys, or the keys of credentials registered from third parties, beyond the recorded rows, or an audit that could not complete. Findings against idempotent-retry response bodies alone are not a failure, because they prove nothing about the key, the application serves those claims without the body, and the next rotation clears them (the audit still exits 1 in that state, so read the report rather than the exit code). An unreachable database is a failed recovery step, not a pass. Stop. Check the pairing record and try the other recorded key for that backup, or another backup. Do not rotate as a way out of key loss; [rotation](./encryption-key-rotation) is a planned change that requires a working outgoing key.
5. Start the application. The first start runs migrations, backfills, and the seed as [startup](./startup) describes. Start it before the worker: the worker runs no migrations and refuses to boot against a database missing one its build ships (see [Worker Boot](./startup#worker-boot)), so a worker started first restarts until the web container has converged the schema.
6. Confirm reads for whichever envelope kinds the backup holds: a known privately stored credential (one whose decryption key is wrapped) reads correctly, and a service instance resolves. Either alone proves the key when the backup holds only that kind. If the backup holds neither, the key cannot be cryptographically proven from it; the pairing record is then the evidence.
7. Return traffic.

## Rotation

Moving the live database to a new key is the [Encryption Key Rotation](./encryption-key-rotation) procedure. Rotation changes what future backups pair with; it does not release the old key until the backups taken under it are gone.
