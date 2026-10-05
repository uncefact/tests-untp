---
sidebar_position: 5
title: Credential status entries
---

# Credential status entries backfill

Run this operator job after upgrading a database that contains native credentials issued before status capture. It reads the stored credential copy, decrypts it when required, checks its digest, parses the provider status entries and records the facts with `BACKFILL` provenance. It never mints a status entry or infers a value.

Run the `pnpm` forms from `packages/reference-implementation`; the packaged `docker compose` form needs no working directory.

The command accepts each option at most once. Options that take a value must have one. Unknown options and extra words are refused.

```bash
pnpm backfill:credential-status-entries
```

The packaged image exposes the same job from `/app`:

```bash
docker compose exec -w /app ri node_modules/.bin/tsx scripts/backfill-credential-status-entries.ts
```

Use `--tenant <tenant-id>` to restrict the scan and all counts to one tenant. Use `--dry-run` to inspect the work without writing. Use `--retry-failed` to retry rows previously classified as `STORAGE_UNAVAILABLE` or `DECRYPT_FAILED`:

```bash
pnpm backfill:credential-status-entries --dry-run
pnpm backfill:credential-status-entries --retry-failed
pnpm backfill:credential-status-entries --tenant <tenant-id> --retry-failed
```

The job is conditional and idempotent. It selects pending rows, writes entries and changes the capture state to `CAPTURED` in one transaction whose state predicate is the state read before storage work. If another process changes the row first, the job reports a write race instead of overwriting it. The summary names the scope, and its `FAILED` count and class counts cover that scope, including rows not selected by this run. The command exits `1` when a row failed in this run or a retryable `FAILED` row remains in scope. Permanent failures are listed by id and class under `Needs inspection` with per-class counts, but do not hold the exit code once no retryable failure remains. The credential stays issued and verifiable, but it cannot be status-managed until an operator inspects and resolves the permanent failure. A clean run exits `0`.

A failed row is reported with one of these classes:

| Class                 | Meaning                                                          | Retryable |
| --------------------- | ---------------------------------------------------------------- | --------- |
| `STORAGE_UNAVAILABLE` | The stored copy could not be read from the storage service       | yes       |
| `DECRYPT_FAILED`      | The stored copy is encrypted and could not be opened             | yes       |
| `UNREADABLE_ENVELOPE` | The copy was read but is not a credential this system can decode | no        |
| `MALFORMED_ENTRY`     | A status entry in the credential does not meet the specification | no        |
| `AMBIGUOUS_PURPOSE`   | The credential carries two entries of the same status purpose    | no        |
| `PURPOSE_MISSING`     | The credential carries no entry for a purpose it was issued with | no        |
| `WRITE_RACE`          | Another process changed the row between the read and the write   | no        |

Fix the reported cause, then use `--retry-failed` for a retryable class. A `WRITE_RACE` is never written to the row, because another process had already moved it, so an ordinary re-run picks the row up again if it is still pending and leaves it alone if that other process captured it. The remaining classes describe the credential itself and need it inspected before the row can be resolved.
