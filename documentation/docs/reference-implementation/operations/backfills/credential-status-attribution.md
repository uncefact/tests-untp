---
sidebar_position: 6
title: Credential status attribution
---

# Credential status attribution backfill

Use this operator job to record which service instance the operator asserts was responsible for native status entries that have no issuance attribution. The write happens regardless of whether the supporting provider evidence agrees or is unavailable; the listed evidence is for the operator to review. Use `--reassign` with the correct instance to reverse an operator assertion:

Run the `pnpm` forms from `packages/reference-implementation`; the packaged `docker compose` form needs no working directory.

```bash
pnpm backfill:credential-status-attribution \
  --tenant <tenant-id> \
  --instance <service-instance-id> \
  --reason "historical service mapping"
```

The packaged image exposes the same job from `/app`:

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-credential-status-attribution.ts \
  --tenant <tenant-id> \
  --instance <service-instance-id> \
  --reason "historical service mapping"
```

Add `--dry-run` to report without writing. Without `--reassign`, the target is a captured native row whose service instance is null. Add `--reassign` to replace an existing `OPERATOR` attribution. The command never replaces `ISSUANCE` attribution and never assigns a row with a pending status mutation. It records the operator, time and reason. The reason is an assertion about historical ownership, not proof supplied by the provider.

For each entry, the command performs one bounded `getCredentialStatus` read through the selected service instance as supporting evidence. Each attributed row reports `evidence: agrees`, `evidence: disagrees: <why>`, or `evidence: unavailable: <why>`. Evidence disagreement or unavailability does not change the exit code or prevent the write. Write races are reported per credential and make the command exit `1`.

With `--dry-run`, the command reports rows as `would attribute` and does not write them.
