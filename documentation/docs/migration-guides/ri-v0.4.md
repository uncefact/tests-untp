---
sidebar_position: 1
title: Reference Implementation v0.4
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

:::warning[Before you upgrade]
Back up the Reference Implementation database, and record the encryption key the
deployment currently runs with (`SERVICE_ENCRYPTION_KEY` in earlier versions). This
release encrypts credential decryption keys at rest under that key, so from this
version onwards **losing the key means losing every service instance configuration and
every credential decryption key stored as an encrypted envelope**. Credential rows
created before this release keep their plaintext stored keys until the
[backfill below](#decryption-key-backfill-for-existing-credentials) wraps them, so they,
like credentials stored unencrypted, are unaffected by key loss. Store the
key with the same care as the database backups: once a backup holds any encrypted
envelope, it cannot be recovered without its matching key. The full pairing, retention, and recovery contract lives in
[Key Management and Recovery](../reference-implementation/operations/key-management).
:::

## Overview

Version 0.4 encrypts the per-credential decryption key before it is persisted, closing
the gap where anyone with read access to the database could recover keys for privately
stored credentials. Alongside the change, the encryption key environment variable is
renamed, and a one-off operator-run backfill encrypts the keys of credentials created
by earlier versions.

## Environment variable rename

`SERVICE_ENCRYPTION_KEY` is renamed to `DATA_ENCRYPTION_KEY` to reflect its broadened
role (it now protects service instance configurations and credential decryption keys).

- Keeping only `SERVICE_ENCRYPTION_KEY` set continues to work and logs a deprecation
  warning. Rename the variable at your convenience; removal of the fallback is tracked
  in [#721](https://github.com/uncefact/tests-untp/issues/721).
- Setting both names to the same value works and logs a reminder to remove the old name.
  The active key's backup pairing and recovery contract is documented in
  [Key Management and Recovery](../reference-implementation/operations/key-management).
- Setting both names to **different values fails before anything encrypted is
  written** (on the standard Docker path this surfaces at startup, when the seed
  resolves the key). The two names are aliases for the same active key, so two
  different values have no valid meaning, and proceeding would split the encrypted
  data across keys (moving data to a new key is a separate maintenance task, see
  [Encryption Key Rotation](../reference-implementation/operations/encryption-key-rotation)). In
  particular, do not copy the placeholder `DATA_ENCRYPTION_KEY` from `.env.example`
  into an existing deployment that still has its real `SERVICE_ENCRYPTION_KEY`; rename
  your existing variable instead, keeping its value.

## RI_APP_URL is required at startup

The application now validates `RI_APP_URL` when it starts and refuses to boot when it is unset, is not a valid `http(s)` URL, or carries a username or password. Earlier versions started without it, skipped the identity provider's end-session redirect on logout, and rejected the first publish that needed the default human verification link. Set `RI_APP_URL` to the deployment's public base URL before upgrading; the shipped `.env.example` and Docker Compose files already default it for local development.

## Decryption-key backfill for existing credentials

Credentials created by earlier versions still hold their decryption key in plaintext.
They keep working unchanged after the upgrade, because the read path recognises legacy
plaintext keys, so this step is not required for continuity. Run it once to bring
existing rows under encryption at rest. Until it has run, the confidentiality
improvement covers only newly issued credentials.

Unlike the backfills that run automatically when the container starts, this one is
deliberately manual: wrapping keys under a wrong `DATA_ENCRYPTION_KEY` would be
unrecoverable, so a human confirms the key before anything is rewritten.

Where it sits in the upgrade:

1. Complete the `SERVICE_ENCRYPTION_KEY` rename above, so the application and the
   backfill agree on which key is active.
2. Preview the work with the read-only audit command, `pnpm audit:encryption` (see [Encryption Audit](../reference-implementation/operations/encryption-audit)), and back up the database, recording the key it pairs with (see [Key Management and Recovery](../reference-implementation/operations/key-management#backups-pair-with-the-key)).
3. Run the backfill, once any older instances that could still write plaintext keys
   have stopped. Re-running after they are gone is safe and converges.

The commands for a source checkout and for the Docker image, the preflight that aborts
on a wrong key, when `--force` applies, and what the run reports are in the
[decryption keys backfill reference](../reference-implementation/operations/backfills/decryption-keys).

## Rollback

After the upgrade has written any encrypted key (a newly issued credential, or a
completed backfill), rolling back to an earlier application version returns the raw
envelope JSON in place of those credentials' decryption keys, because earlier versions
have no unwrap step. Plan the upgrade as forward-only once credentials have been
issued, or restore the paired database backup when rolling back.

## Key rotation

Existing envelopes are readable only under the key that wrote them, so changing
`DATA_ENCRYPTION_KEY` in place makes them unreadable. To move data onto a new key,
follow the [Encryption Key Rotation](../reference-implementation/operations/encryption-key-rotation)
procedure, which re-encrypts every stored envelope with the `rotate:encryption-key`
maintenance command.
