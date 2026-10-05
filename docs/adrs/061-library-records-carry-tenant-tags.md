# ADR-061: Library records carry tenant tags

- **Date:** 2026-10-05
- **Status:** accepted

## Context

An application built on the reference implementation can show some credentials in its own screens while also registering them in a tenant's credential library. Its library screen then shows those credentials a second time. Filtering them out in the client breaks paging. If a page of 20 records holds three that the other screen already shows, the client displays 17, and `pagination.total` and `hasMore` no longer describe what the user sees. The exclusion has to happen in the list query (#1108).

The library already holds one kind of tenant-asserted data, the recipient annotations on an external record (ADR-053). They exist only on external records, carry the recipient's view of a credential someone else issued, and are guarded by their own `annotationVersion` token. A native record has none, and `PATCH /api/v1/library/{id}` refuses it with `403 NATIVE_CREDENTIAL_NOT_ANNOTATABLE`.

The library surface (ADR-052) lists, fetches and edits records under `/api/v1/library`. Every library read projects the record through one shared projection, and a row the projection cannot represent is reported in `failures` rather than failing the response (ADR-057). Background work runs on a separate worker process that takes jobs from a Postgres queue (ADR-054). A batch issuance stores each item's validated request encrypted and the worker issues it later through the ordinary issuance path (ADR-060).

## Decision

1. **Tags are tenant-asserted labels on the parent record, for both origins.** `LibraryRecord` gains `tags`, a text array, and `tagVersion`, an integer. Both are `NOT NULL`, with defaults of an empty array and `1`, so every existing record starts untagged at version 1. Tags live on the parent because they apply to native and external records alike, unlike annotations, which live on the external child. Tags are never part of the credential itself.

2. **Tags are set at creation and replaced as a whole.** A request can set `tags` when it registers an external credential, when it issues a single credential and on each item of a batch issuance, and the tags are written in the transaction that creates the record. After creation, `PUT /api/v1/library/{id}/tags` replaces the full list under an `If-Version` header carrying the current `tagVersion`. An empty list clears the tags. Every successful PUT advances `tagVersion` by one and moves `updatedAt`, even when the list is unchanged, as the annotations PATCH does. The route follows the PATCH's order of checks. Responses show top-level `tags`, `tagVersion` and `capabilities.taggable`, which is `true` on every record.

3. **Tags have their own version token.** `tagVersion` is separate from `annotationVersion`, so a tag change and an annotation change never invalidate each other's token. A client tagging records does not have to know or re-read the annotations, and the reverse.

4. **The format is fixed and the limits are admission policy.** A tag matches `^[a-z0-9]+(?:-[a-z0-9]+)*$`, a list may not repeat a tag, and values are stored exactly as sent. The count limit (`API_MAX_TAGS_PER_RECORD`, default 10) and the length limit (`API_MAX_TAG_LENGTH`, default 64) are read by the web process when tags come in: register, issue, each batch item and PUT. An invalid value logs a startup warning and the default applies, as for `API_MAX_PAGE_LIMIT`. The limits are not stored invariants. Nothing checks them against stored records, the worker never reads them or re-checks a queued batch item's tags, and they do not apply to list filter values. After a deployment lowers a limit, a record over the new limit keeps its tags, and a PUT that is still over the limit is refused naming the limit. The limits are not published in the OpenAPI document, for the same reason as the page limit.

5. **Responses do not re-check the format.** The outbound record schema publishes `tags` as an array of strings with no pattern, and `tagVersion` as an integer of at least 1. The format is enforced where tags come in, and on the `tag` and `excludeTag` query values. A read never fails because of a tag that was stored under different rules.

6. **The list filters run in the query.** `GET /api/v1/library` accepts `tag` and `excludeTag`, both repeatable. Values in one parameter are combined with `OR` and the two parameters with `AND`, so exclusion wins. Both are predicates inside the query that selects and counts the page, so `pagination.total` and `hasMore` count only matching records, including any reported in `failures` (ADR-057). A value that breaks the format is a `400` naming the parameter.

7. **No index on `tags`.** The list is already scoped to the tenant by its existing index. A GIN index over the array serves the overlap and containment operators, so it could help `tag`, but it cannot serve `NOT (tags && ...)`, which is the `excludeTag` case that motivated the feature. A GIN entry also has a maximum size, so with the index a much larger `API_MAX_TAG_LENGTH` could make an insert fail after the credential was signed. Revisit with measurements of inclusion-heavy queries on a large tenant. Adding the index then needs a hard ceiling on the length setting in the same change.

8. **This release relies on an upgrade order.** Batch items carry their tags inside the stored item request, not in the job payload, and a worker older than this release issues an item without its tags. An older web replica drops `tags` from the request bodies it serves, ignores a single `tag` or `excludeTag` value, refuses a repeated one with a 400, and has no tags route. The order is therefore: apply the tags migration, stop the old workers and start the new ones, then expose the new web. With the bundled Compose stack, the whole stack is rebuilt and recreated with one `docker compose up -d --build`, and the new worker restarts until the web has applied the migration. No code guard enforces the order.

## Consequences

An integrator can group records and leave some out of a library listing with paging that stays correct. Native records, which cannot be annotated, can be tagged. Tag edits and annotation edits do not contend for one version token.

Every library record gains three response fields. A client that validates responses against a pinned copy of the published schema has to regenerate it.

Changing a limit is a deployment setting, not a migration. Because the limits are not stored invariants, lowering one leaves over-limit records in place, and the next edit of such a record has to bring it within the limit.

Tags are opaque to the reference implementation. There is no endpoint that lists the tags in use or counts records per tag, and a rename means a PUT on every affected record.

The upgrade order is a documented operator step rather than an enforced one. A deployment that exposes the new web before replacing its workers can issue tagged batch items without their tags.

## Alternatives Considered

- **Tags inside the recipient annotations.** Rejected because annotations exist only on external records, and a native record would have no place for tags. It would also put tag edits and annotation edits behind one token, so each would conflict with the other.
- **One version token shared with annotations.** Rejected for the same conflict, and because native records have no annotation token to share.
- **A join table of tags.** Rejected because no per-tag metadata or per-tag counts are needed, and a text array on the parent keeps the record and its tags in one row. Revisit if an endpoint listing the tags in use is asked for.
- **Adding and removing individual tags instead of replacing the list.** Rejected because a full-list replace under a version token gives one simple concurrency rule, and the request bodies on the four routes that take tags carry the same bare array.
- **A `{ values, version }` object in responses.** Rejected so that the response shape matches the bare array the requests carry, with the version beside it as `tagVersion`, as `annotationVersion` sits beside the annotations.
- **Re-checking the limits in the worker or on reads.** Rejected because the limits are admission policy. A batch item the web accepted issues as it was accepted, and a read that failed on a stored record would hide data the tenant already holds.
- **A GIN index now.** Deferred, for the reasons in decision 7.
- **Filtering in the client.** Rejected because it breaks `pagination.total` and `hasMore`, as the context describes.

## References

- #1108
- [ADR-052](./052-credential-library-surface.md): the library API surface
- [ADR-053](./053-credential-library-record.md): the parent and child record and recipient annotations
- [ADR-054](./054-background-work-runs-on-a-worker.md): the worker and its version skew
- [ADR-057](./057-library-reads-degrade-per-row.md): `failures` and list accounting
- [ADR-060](./060-batch-issuance-is-a-queue-of-ordinary-issuances.md): stored batch item requests
- [Library API](../../documentation/docs/reference-implementation/api/library.md#tags)
- [API Pagination](../../documentation/docs/reference-implementation/operations/api-pagination.md#tag-limits)
