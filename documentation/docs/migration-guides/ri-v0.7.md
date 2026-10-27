---
sidebar_position: 0
title: Reference Implementation v0.7
---

import Disclaimer from '.././\_disclaimer.mdx';

<Disclaimer />

This guide covers upgrading a Reference Implementation deployment from v0.6.2 to v0.7. A deployment on v0.6.0 or v0.6.1 first follows the [v0.6 guide](./ri-v0.6). A deployment already running v0.7.0 needs only [Upgrading from v0.7.0](#upgrading-from-v070), [Upgrading from v0.7.1](#upgrading-from-v071) and [Upgrading from v0.7.2](#upgrading-from-v072). One running v0.7.1 needs only the last two, and one running v0.7.2 needs only the last.

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

## Upgrading from v0.7.0

v0.7.1 changes no setting, database migration or Compose file. When no batch is running, deploy the v0.7.1 image, or rebuild the bundled Compose stack, and restart the web process and every worker. [Upgrading from v0.6.0](./ri-v0.6#upgrading-from-v060) explains what a worker restart during a batch does.

`backfill:credential-status-attribution` now reads its evidence with each status entry's stored canonical coordinates. From v0.6.0 through v0.7.0, it reported `evidence: unavailable` for every credential whose stored status descriptor carries a numeric `statusListIndex`, which is how the Reference Implementation issues it, while still writing the attribution. Such a credential now reports `evidence: agrees` when the provider read succeeds. [Credential status attribution](../reference-implementation/operations/backfills/credential-status-attribution) describes the read, and the [release notes](https://github.com/uncefact/tests-untp/blob/next/packages/reference-implementation/RELEASE_NOTES.md) list every change in v0.7.1.

## Upgrading from v0.7.1

v0.7.2 changes no setting or database migration. The bundled Compose files move from storage service 4.0.0 to 4.0.1. When no batch is running, deploy the v0.7.2 image, or rebuild the bundled Compose stack with `docker compose up -d --build`, and restart the web process and every worker. [Upgrading from v0.6.0](./ri-v0.6#upgrading-from-v060) explains what a worker restart during a batch does.

The v0.7.2 image is published for `linux/amd64` only. The `:0.7.1` image keeps its `linux/arm64` variant, and `:latest` has none once it moves to v0.7.2.

The sign-in check cookies are now bound to their provider, so a sign-in started before the deploy and finished after it may need to be started again.

Creating a render template, or replacing a template's content, is now refused with a `400` when the sanitised template, read the way a browser reads HTML inserted into a page, would build an element, an attribute or a URL scheme that the sanitiser does not allow. Templates stored before v0.7.2 are not checked again, and the credential renderer shows them as stored. [Template Content and Sanitisation](../reference-implementation/api/render-templates#template-content-and-sanitisation) describes the rule.

Storage service 4.0.1 refuses an upload whose field name is nested two or more levels deep or carries an array index above 0. The Reference Implementation uploads with the plain field names `file`, `id` and `bucket`, so its uploads are unaffected. The [release notes](https://github.com/uncefact/tests-untp/blob/next/packages/reference-implementation/RELEASE_NOTES.md) list every change in v0.7.2.

## Upgrading from v0.7.2

v0.7.3 changes no Reference Implementation setting or database migration. It changes one thing API clients see, described below. The bundled Compose files move to VCKit 1.2.2, storage service 4.0.2, Pyx Identity Resolver 4.0.1 and Keycloak 26.7.5, each pinned by digest. A deployment that runs its own copies of those services moves them to the same versions, deploys the v0.7.3 image, and restarts the web process and every worker when no batch is running. For the bundled stack, when no batch is running, stop it with `docker compose down`, change the storage volume's owner as described below, pull the v0.7.3 release, and start it with `docker compose up -d --build`. [Upgrading from v0.6.0](./ri-v0.6#upgrading-from-v060) explains what a worker restart during a batch does.

Credential issuance now refuses an issuer DID whose status is not `ACTIVE` or `VERIFIED`, with `400 ISSUER_DID_NOT_ISSUABLE`, on `POST /api/v1/credentials` and for each batch item. Before v0.7.3 such a DID signed credentials, even though the RI had not confirmed its DID document resolves. A client that issues with a self-managed DID it has not verified gets this refusal after the upgrade. Host the DID document and verify the DID with `POST /api/v1/dids/{id}/verify` first. Once it is `VERIFIED` it issues as before. Managed DIDs and the system default DID start as `ACTIVE` and issue as before while they stay `ACTIVE` or `VERIFIED`. A managed DID whose verification failed is refused too, until a verification passes. [Issuer DID ownership validation](../reference-implementation/api/credentials#stage-4-issuer-did-ownership-validation) describes the check.

Storage service 4.0.2 runs as uid 1000 rather than root. Before you start an upgraded bundled stack whose storage volume an earlier stack wrote to, stop the stack with `docker compose down` and change the volume's owner once, as the warning under [Start the Stack](../reference-implementation/quick-start#start-the-stack) in the quick start describes. A deployment that runs its own storage service on local storage needs the same step for its uploads directory. Storage on S3 needs no step. Google Cloud Storage with a mounted service account file needs that file to be readable by uid 1000. The [storage service notes](https://github.com/uncefact/project-storage-service/blob/v4.0.2/RELEASE_NOTES.md#before-you-deploy-402) also cover rootless Docker, user namespace remapping, a custom `LOCAL_DIRECTORY` and Kubernetes.

The [release notes](https://github.com/uncefact/tests-untp/blob/next/packages/reference-implementation/RELEASE_NOTES.md) list every change in v0.7.3.
