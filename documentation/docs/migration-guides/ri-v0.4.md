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
version onwards **losing the key means losing access to every privately stored
credential**. Store the key with the same care as the database backups: a database
backup without the matching key cannot be recovered.
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
- Setting both names to **different values fails before anything encrypted is
  written** (on the standard Docker path this surfaces at startup, when the seed
  resolves the key). Two different keys have no valid meaning (key rotation is not
  yet supported), and proceeding would split the encrypted data across keys. In
  particular, do not copy the placeholder `DATA_ENCRYPTION_KEY` from `.env.example`
  into an existing deployment that still has its real `SERVICE_ENCRYPTION_KEY`; rename
  your existing variable instead, keeping its value.

## Decryption-key backfill for existing credentials

Credentials created by earlier versions still hold their decryption key in plaintext.
They keep working unchanged after the upgrade (the read path recognises legacy
plaintext keys), so the backfill is not required for continuity. Run it once to bring
existing rows under encryption at rest; until it has run, the confidentiality
improvement only covers newly issued credentials.

Unlike the automatic data backfills that run when the container starts, this backfill
is deliberately manual: wrapping keys under a wrong `DATA_ENCRYPTION_KEY` would be
unrecoverable, so a human confirms the key before anything is rewritten.

Before running it:

1. Back up the database.
2. Confirm `DATA_ENCRYPTION_KEY` is exactly the key the running application uses.
3. Stop any older application instances that might still write plaintext keys during a
   rolling upgrade (or plan to re-run the backfill after they are gone; re-running is
   safe and converges).

From a source checkout, in `packages/reference-implementation`:

```bash
pnpm backfill:decryption-keys
```

Inside the published Docker image (which ships no pnpm):

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-decryption-keys.ts
# with the force flag, after out-of-band key verification and a backup:
docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-decryption-keys.ts --force
```

The run protects itself before writing anything: it decrypts every existing encrypted
value it can find (credential keys and service instance configurations) and aborts on
any failure, naming the failing row. When the database holds nothing encrypted to
check against, the run refuses to proceed and asks for `--force`; only pass it after
verifying the key out of band, with a backup in hand:

```bash
pnpm backfill:decryption-keys -- --force
```

Rows whose stored value looks like a corrupted envelope are skipped and listed rather
than re-encrypted; inspect any such rows manually. After the run, confirm a wrapped
key still round-trips by retrieving a credential through the API
(`GET /api/v1/credentials/{id}`) and checking its `decryptionKey` verifies as before.

## Rollback

After the upgrade has written any encrypted key (a newly issued credential, or a
completed backfill), rolling back to an earlier application version returns the raw
envelope JSON in place of those credentials' decryption keys, because earlier versions
have no unwrap step. Plan the upgrade as forward-only once credentials have been
issued, or restore the paired database backup when rolling back.

## Key rotation

Rotating `DATA_ENCRYPTION_KEY` is not yet supported: existing envelopes are readable
only under the key that wrote them. Support for rotation is tracked in
[#720](https://github.com/uncefact/tests-untp/issues/720). Until it lands, treat the
key as immutable and recoverable.
