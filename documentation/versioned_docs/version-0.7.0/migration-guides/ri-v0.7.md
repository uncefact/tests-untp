---
sidebar_position: 0
title: Reference Implementation v0.7
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

This guide covers upgrading a Reference Implementation deployment from v0.6.2 to v0.7. A deployment on v0.6.0 or v0.6.1 first follows the [v0.6 guide](./ri-v0.6).

v0.7 lets a tenant put tags on library records and filter the library list by them. See [Tags](../reference-implementation/api/library#tags) in the Library API.

## Upgrading from v0.6.2

The `20261005120000_library_record_tags` migration adds `tags` and `tagVersion` to every library record. During a rolling web deploy, an older web replica drops `tags` from request bodies, ignores a single `tag` or `excludeTag` value, refuses a repeated one with a 400, and has no tags route.

Upgrade when no batch is running. [Upgrading from v0.6.0](./ri-v0.6#upgrading-from-v060) explains what a worker restart during a batch does.

Upgrade in this order:

1. Apply the `20261005120000_library_record_tags` migration.
2. Stop the old workers and start the new ones.
3. Expose the new web.

With the bundled Compose stack, rebuild and recreate the whole stack with one `docker compose up -d --build`, not the `ri` service alone. The new worker restarts until the web has applied the migration.

## Tag settings

Two settings bound the tags a request may put on a record. Set them on the web process only, because the worker does not read them.

| Variable                  | Default | Bound                                |
| ------------------------- | ------- | ------------------------------------ |
| `API_MAX_TAGS_PER_RECORD` | `10`    | The number of tags a record may hold |
| `API_MAX_TAG_LENGTH`      | `64`    | The length of one tag, in characters |

A value that is not a positive integer logs a warning at startup and the default applies, as for `API_MAX_PAGE_LIMIT`. The limits apply when tags come in, never to stored records. After you lower a limit, a record that holds more tags than the new limit keeps them, but a PUT that is still over the limit is refused naming the limit. See [Tag limits](../reference-implementation/operations/api-pagination#tag-limits).

## Library record responses

Every record returned by the library routes gains `tags`, `tagVersion` and `capabilities.taggable`. Clients that validate responses against a pinned copy of the published schema must regenerate it.

## Tagging existing records

Records created before v0.7 start with `tags: []` and `tagVersion: 1`. Tag them with [`PUT /api/v1/library/{id}/tags`](../reference-implementation/api/library#replace-a-records-tags), sending the record's `tagVersion` in `If-Version`.
