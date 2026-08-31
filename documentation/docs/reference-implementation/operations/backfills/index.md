---
sidebar_position: 1
title: Backfills
---

# Backfills

A migration changes the shape of the tables. It does not always bring the rows that already exist into line with what the new version writes. A backfill does that second part, converting existing rows to the format the current version expects.

There are two kinds, and the kind decides who runs a given backfill.

**Automatic backfills** run by default on every container start, as [step 2 of the startup sequence](../startup#step-2-data-backfills), so an upgraded instance converts itself as it boots. A run against the wrong database can be undone from the data it leaves behind, which is what makes it safe to run unattended.

**Operator-run backfills** ship in the image and run only when you invoke them. A human chooses the moment, having taken a backup and confirmed the environment, because a write cannot be undone or because the job reaches outside the database. They are not part of the startup sequence, and an instance that never runs one keeps working: the application still reads the old shape.

| Backfill                                   | Kind         | Converts                                                                                     |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------- |
| [Digest multibase](./digest-multibase)     | Automatic    | Credential and render template digests from hexadecimal to multibase                         |
| [Decryption keys](./decryption-keys)       | Operator-run | Credential decryption keys from plaintext to encrypted envelopes                             |
| [Credential details](./credential-details) | Operator-run | Descriptive fields and data-model version on credentials issued before those columns existed |

Each is safe to run more than once. A backfill recognises the rows it has already converted and leaves them alone, so a repeated run converges rather than rewriting.

The reasoning behind the split, and the rules a new backfill follows, are recorded in [ADR-043](https://github.com/uncefact/tests-untp/blob/next/docs/adrs/043-data-backfill-conventions.md).
