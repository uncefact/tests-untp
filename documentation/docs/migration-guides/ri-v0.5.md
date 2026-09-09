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

## Credential fetch settings have new names

v0.5 renames the shared credential-fetch settings so their names describe the operation rather than the verify route. The old names remain supported throughout the v0.5 compatibility window and are planned for removal in RI v0.6.

| Old name                     | New name                   |
| ---------------------------- | -------------------------- |
| `VERIFY_ALLOW_PRIVATE_URLS`  | `FETCH_ALLOW_PRIVATE_URLS` |
| `VERIFY_MAX_CREDENTIAL_SIZE` | `FETCH_MAX_RESPONSE_SIZE`  |
| `VERIFY_FETCH_TIMEOUT_MS`    | `FETCH_TIMEOUT_MS`         |

The values do not change. For example, `VERIFY_MAX_CREDENTIAL_SIZE=2048` becomes `FETCH_MAX_RESPONSE_SIZE=2048`, and `VERIFY_FETCH_TIMEOUT_MS=3210` becomes `FETCH_TIMEOUT_MS=3210`. The boolean still enables only for exact lowercase `true`, the size still uses its existing `parseInt` fallback, and the timeout still accepts an integer from 1 through 120000 milliseconds.

Before renaming, check the boolean's Compose behaviour. The bundled deployment Compose file now forwards both names independently with a blank default, while the E2E test harness defaults its new boolean name to `true` because its services use private container names. A `.env` value of `false` or any value other than exact lowercase `true` was ignored by the deployment's forced setting before the upgrade and is honoured after it. Remove `VERIFY_ALLOW_PRIVATE_URLS` from the root `.env`; if you set it deliberately, rename it to `FETCH_ALLOW_PRIVATE_URLS` without changing the value. If local storage, IDR or VCKit still needs private or loopback URLs in a deployment, set `FETCH_ALLOW_PRIVATE_URLS=true`. If strict checks were intended, keep a non-`true` value and that value is now honoured. Never set a production deployment to `true` to preserve the old Compose behaviour. The E2E stack needs no env file for its private-container default. A stale root `.env` carrying `VERIFY_ALLOW_PRIVATE_URLS` alongside the E2E default reaches the app with both names and fails startup with the conflict message.

Two non-blank names for one setting fail startup, even when both values are `true` or otherwise equal. These three settings fail on equal values where the encryption-key rename warns because a boolean or a byte count carries no same-value-means-the-same-secret protection.

Migration steps:

1. Find existing old-name entries in the deployment environment, Compose inputs and overrides, CI variables, manifests and scripts. Decide which value is intended where both names already exist.
2. Rename each old entry to its mapped new name, keeping the value unchanged. Remove the old entry from every input source for that process. Do not add a second active name during the transition.
3. Upgrade custom Compose or deployment forwarding to carry both names independently during the window, as the bundled deployment Compose file does. This lets an old-only deployment upgrade before its rename is completed.
4. Before recreating a container, ensure the intended boolean name is the only non-blank name in its environment. Recreate the web app container so its environment changes: run `docker compose up -d --force-recreate ri` for the normal stack. For the E2E stack, use its existing file and profile arguments with service `app`, and keep the closed-mode override on every command when applicable. Restart a directly run web process.
5. Check startup logs for conflicts and deprecated-name warnings. Align Cypress capability input with the running app and normalise all deployments onto the new names before the planned v0.6 removal.

These fetch settings do not require a key rotation, database migration or worker-only configuration change. The worker uses its separate durable-copy read timeout. See the [evergreen startup table](../reference-implementation/operations/startup#credential-fetch-settings) for the runtime messages and rules.
