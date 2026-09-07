---
sidebar_position: 0
title: Reference Implementation v0.5
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

This guide covers upgrading a Reference Implementation deployment from v0.4 to v0.5.

## `SERVICE_ENCRYPTION_KEY` is no longer read

**Breaking change.** v0.4 renamed the encryption key variable from `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY` and kept reading the old name as a deprecated fallback, logging a warning at startup. v0.5 removes that fallback. The application and the seed read `DATA_ENCRYPTION_KEY` alone, and a deployment that still holds its key only under the old name no longer starts. (The offline [rotation command](../reference-implementation/operations/encryption-key-rotation) reads its key pair directly and never honoured the fallback. The only change there is that its missing-key error now points at the rename when the old name is the one set.) The fallback existed only to let v0.4 deployments upgrade without breaking, and keeping two names for one key indefinitely invites exactly the divergence the rename was meant to end.

The value does not change, only the name. If your deployment already sets `DATA_ENCRYPTION_KEY` (as the [v0.4 guide](./ri-v0.4) instructed), remove any leftover `SERVICE_ENCRYPTION_KEY` and no other action is needed.

**Before** (v0.4, worked with a deprecation warning):

```bash
SERVICE_ENCRYPTION_KEY=<your 64-character hex key>
```

**After** (v0.5):

```bash
DATA_ENCRYPTION_KEY=<your 64-character hex key>
```

What v0.5 does when the old name is still present (whitespace-only values count as unset throughout):

| Environment | Behaviour |
|-------------|-----------|
| Only `DATA_ENCRYPTION_KEY` set | Normal operation |
| Only `SERVICE_ENCRYPTION_KEY` set | Startup and the seed fail with the message `SERVICE_ENCRYPTION_KEY is set but is no longer read … Rename it to DATA_ENCRYPTION_KEY and restart.` Nothing encrypted is written before the failure. |
| Both set to the same value | The key comes from `DATA_ENCRYPTION_KEY`; a startup warning asks you to remove the leftover `SERVICE_ENCRYPTION_KEY`. |
| Both set to different values | Startup, the seed, and the maintenance commands that use the application's key resolution refuse to run, as in v0.4, but for a different reason and with different advice: the old name is not a key, so with two values the process cannot tell which one you intended and will not pick `DATA_ENCRYPTION_KEY` for you. The message names both remediations (if the old name holds your real key, set `DATA_ENCRYPTION_KEY` to it; if `DATA_ENCRYPTION_KEY` is already right, including after a completed rotation, remove the old name). |

Migration steps:

1. In your `.env` (or wherever the deployment holds its environment), rename `SERVICE_ENCRYPTION_KEY` to `DATA_ENCRYPTION_KEY`, keeping the value byte for byte. Skip this if the v0.4 rename was already done.
2. Remove any remaining `SERVICE_ENCRYPTION_KEY` entry, including copies in CI variables, secret stores, and deployment manifests.
3. Restart the application and the background worker. Containers capture their environment when created, so recreate both containers rather than only editing `.env` (`docker compose up -d --force-recreate ri ri-worker` for compose deployments; the worker reads the same key).

If you use the [encryption audit](../reference-implementation/operations/encryption-audit) as a one-off container between a rotation and the removal of the leftover old name, keep the `-e SERVICE_ENCRYPTION_KEY=` override that page shows. The audit resolves its key the same way the application does, and a leftover holding the previous key differs from the new `DATA_ENCRYPTION_KEY`.
