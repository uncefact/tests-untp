# ADR-053: A library record is a view of what we have, not a copy of it

- **Date:** 2026-08-25
- **Status:** accepted
- **Amended (2026-09-02):** decisions 1, 2 and 5 replaced, decision 3's reference reduced to one foreign key, decision 4 made explicit about storage, and decision 8 added, before any of the tables existed in a deployment. The first implementation of registration (#955) showed that two record tables with no shared parent declare the extracted fields twice, need an exclusive pair of foreign keys on every table that points at a record, and make the list a union of two shapes. The record is now one parent row that each origin extends. The migration that makes the change is marked no-rollback under ADR-024: it moves columns off `Credential` and a previous version cannot insert a credential without the parent row. Decisions 6 and 7 stand as written.
- **Update (2026-09-03):** The migration that creates the parent rows derives each existing credential's core kind (decision 8) itself, because issuance never recorded which extension data model version it resolved and the choice cannot be replayed. A core type name maps directly. An extension name is looked up among the extension data models of that name visible to the tenant (its own and the system tenant's, the rule issuance used), preferring those whose core parent's version matches the credential's recorded core version, and a kind is taken only when every candidate agrees; otherwise the record is written with a null core kind rather than a guess. The details backfill (#953) also selects records whose core kind is null, whatever their extraction status, and fills it in from the signed credential's type array alone (a record still pending extraction may pick its bridge by its asserted type when that is a core name, the rule issuance validated it under), so a record the migration left null is converged by the next run when the array names its kind, and stays reported otherwise. A change to a credential's entity links, including the null the database writes when the linked entity is deleted, touches the record's last-modified time through a database trigger, so decision 1 holds whatever transaction made the change. A check run (decision 3) also carries its record's tenant and references the record by (id, tenantId), so a run is read under the same key the record is. The migration also creates the three indexes the library list will need beside the tenant key, on the core credential type, on the issuer DID, and on the lower-cased issuer name, so the list has something to read from the day the tables exist. #962 confirms or replaces them against the real list query.

## Context

The library (`/api/v1/library`, ADR-052) lists everything a tenant holds: **native** credentials the tenant issued through this system, and **external** credentials other parties issued and sent to the tenant out of band. This ADR decides what a row in that list actually is.

Native credentials already live somewhere. Issuance writes a row to the `Credential` table (`prisma/schema.prisma`), and the storage service holds the signed artefact durably. The row carries the storage location, the digest, the decryption key, and the links to the tenant's master data. Nothing about that changes.

External credentials have nowhere to live at the moment. Registering one fetches it from its source and stores a durable copy, and the record has to remember what only an external credential has: where it came from, where our copy is, and whether we hold a key that opens it.

Registration also verifies the credential, and verification is never a once-only fact. A result is true of the moment it ran: a revocation made directly against the verification service only shows up the next time someone checks. So a credential of either origin can be re-verified at any time, an external one to reconfirm what registration found, a native one to catch a status change made out from under us.

That means a record of either origin gathers verification results over time, each one a fact about the moment it ran, with a newer result superseding an older one rather than rewriting it.

The tempting shape is one new `LibraryRecord` table that everything is copied into: issuance inserts a library row next to its credential row, registration inserts one for each external credential, and the list reads one table. One table, one query, done.

So the question is: is a library record its own copy of the data, or a view over where the data already lives?

## Decision

1. **A library record is one row in a parent table, `LibraryRecord`, and each origin is a child table that shares the parent's id.**
   The parent row is identity (the tenant, the origin) and the fields that are the same for both origins by construction (decision 5). It is never a copy of a child's data, which is what the rejected library-table shape below would have been: a copy is written twice and disagrees with its source the first time one write fails. A native record's library id is its `Credential` id, because the child shares the parent's key; an external record's id is minted at registration, opaque, by us. Neither is ever the id written inside the credential document itself; a document's self-asserted id is the issuer's claim, not our identity for the row.
   The database holds the shape, not a convention. Each child carries its origin and references the parent through a composite foreign key on id, tenant and origin, so a child can only attach to a parent of its own origin and tenant, and a parent can never have both children. Deferred constraint triggers refuse to commit a parent with no child, and refuse a child whose parent still exists at commit, so a child never outlives its parent. Deleting the parent cascades to the child, the verification runs and the idempotency claim. The write paths create parent and child in one transaction.
   The parent's `updatedAt` is the record's last-modified time. A write to a child (an annotation edit, a custody change, a publication flag) touches the parent in the same transaction, so the list can sort and filter on one column. Settling a check run does not touch it, because verification state is projected from the run, which carries its own timestamps. So `updatedAt` answers when the record's stored fields or annotations last changed. Rewrapping a stored key under a rotated encryption key changes no field a consumer reads and does not touch it either.

2. **Each origin's child table holds only what that origin has.**
   `Credential` (native) keeps its storage location, digest, receiver-side key, publication state and master-data links. `ExternalCredential` keeps the source URL and digest, what the fetch observed, the durable copy's coordinates and key, and the recipient's annotations. Almost nothing carries across between them, so a single wide table would make every rule on it conditional on origin; two children keep each side's rules unconditional. Everything that must point at a record (a verification generation, an idempotency claim) points at the parent through one foreign key, so a new origin is a new child table, never a new nullable column on every referencing table.

3. **Verification results are a third table: one row per generation, belonging to exactly one record.**
   A generation row points at its record through one foreign key to the parent table (decision 1), so the database enforces the relationship and cascades deletion; we never join through a bare id column.
   Generations are numbered from 1 and only ever added. What that buys is ordering: a stale result can never overwrite a newer one, and two verifications racing each other cannot corrupt the record's answer. Nobody has asked for the past results as a feature; the surface only ever shows the current one. Keeping them is a side effect of append-only being the simplest safe shape, and deleting a record cleans its generations away with it.

4. **Generation 1 means a different thing for each origin, and the record says so honestly.**
   An external record's generation 1 is a real verification: the whole point of registering is to check a credential we did not make. It is a stored row, written at registration.
   A native record's generation 1 is an issuance assertion, not a verification. Issuance signs and stores the credential; it does not run the verification pipeline over the finished artefact. The assertion records that, and no more: the checks that need an external source are marked as not run, and the proof check reports what actually happened, which is that we signed it ourselves moments earlier. It is never stored: it is synthesised at read time from the credential row, so a native record's first stored generation is 2, written by re-verification.
   From generation 2 onward, both origins are the same: a re-verification really runs the pipeline. That is how an out-of-band revocation of a native credential becomes visible here.
   The distinction is kept visible on every surface. A consumer can always tell "this system vouches for what it did" from "this system checked".

5. **The descriptive fields extraction produces live on the parent row, once, written in the same transaction that creates the record.**
   Name, issuer name and DID, subject name and id, validity dates, the type (decision 8), the data-model version, and the extraction status and reason are read from the signed artefact whether we issued it or received it, so they belong to the record, not to an origin. The type of a native record is the one exception: it comes from the data model issuance resolved (decision 8), which is the same name the artefact carries. The list shows them without opening the stored artefact. Issuance writes them in the persist that creates the row, on the code path every way of issuing passes through, so no entry point can create a credential without its captured fields; registration writes them the same way. #980 first shipped this capture onto the `Credential` row; the amendment moves those columns to the parent.
   The capture reads the signed artefact, not the request. If signing fails, nothing is captured and issuance fails exactly as it does today.
   The row says how the capture went. `detailsStatus` is `EXTRACTED`, `EXTRACTION_PENDING` (the default every pre-capture row wears until the operator-run backfill (#953) reaches it), or `EXTRACTION_FAILED`, and a failure records why (`detailsError`: an unreadable envelope, a bridge error, a failed decrypt), so a later run knows which failures a code fix or a restored key makes worth retrying, and a reader can tell "not yet extracted" from "this credential has no such data".

6. **Every record carries capability flags, so a consumer never re-derives our rules.**
   `deletable`, `annotatable`, and `verifiable` are present on every record, computed by us from origin and custody state. A screen decides what buttons to show by reading them, not by re-implementing the rules behind them.
   `verifiable` is also a seam. It is always `true` in v1; the future document mode from ADR-052's transition, a received PDF held in the library, would be the first record to carry `false`. That mode rests on two things nobody has checked against source, whether the storage service accepts a binary payload on both its public and private endpoints, and whether a private-bucket object is fetchable by anyone holding its URI and key, and the ticket that scopes it checks both before building.

7. **An envelope's legal shapes are enforced where envelopes are built, at runtime, by one schema that also generates the published contract.**
   An envelope in a given state may only carry certain fields, and the published OpenAPI schema says so, but a schema constrains documents; it cannot stop a server emitting a bad one. So every envelope is built through one constructor per state, those constructors are the only place envelopes are built, and each checks its inputs at runtime with a Zod schema, the same library ADR-037 uses at the inbound boundary, applied outbound. An illegal combination fails where someone tried to build it, before it can become a response.
   That Zod schema is the single source of truth: the published OpenAPI component is generated from it, through the generation path the repository already has, and it ships with whichever library route first returns an envelope. The contract and the enforcement cannot drift, because they are one artefact.

8. **The type is recorded twice, because it is two facts, and each origin gets them from its own most authoritative source.**
   `credentialType` is the asserted type, an extension's own name when it is one: a credential's type is not limited to the five UNTP core types, since an extension data model carries its own name and points at a core parent (`data-models.md`), and the extension credentials in this repository's test suite name both the extension and its core type in `type`. `coreCredentialType` is the core kind, one of `DFR`, `DCC`, `DPP`, `DTE`, `DIA`.
   For a native record both come from the registered data model issuance resolved: the asserted type is that model's `credentialType`, the key issuance resolved it by, and the core kind is its core parent's. For an external record both are read from the artefact: the `type` array is treated as a set, the asserted type is the first entry that is neither a core name nor `VerifiableCredential` (else the core name), and the core kind is the one distinct core name the set contains. A set naming two core kinds, or none, gives a null core kind, and extraction then records `EXTRACTION_FAILED` with a bridge error, because no bridge can be chosen. A matching registered data model (same tenant or system, matched on context) is the fallback the register route may add later; it is not decided here.
   Both are derived once, when the row is written, which keeps a nested extension, which the data-model documentation anticipates, a one-time walk of the parent chain rather than a per-read one. The API's type field carries the core kind; the list's type filter uses it where present and falls back to a recipient's declared type where it is null, as the contract already decided; a declared-type mismatch is reported only when both are present and differ.

## Consequences

Positive:

- The library cannot drift from issuance: a native record's identity and descriptive fields are written in the same transaction as its credential row, and nothing is copied later.
- Each origin's child table stays simple. No column is "only meaningful when...". A field added to extraction is added once, on the parent.
- Every table that points at a record carries one reference, and a third origin is a third child table.
- Verification history is append-only and referentially sound, and the honesty line between vouching and checking is structural, not a convention.
- The list is cheap. It paginates and filters one table, joins one child for origin detail, and never opens a stored artefact to answer a query.

Negative:

- Every record write is two rows, parent and child, and a detail read of either origin is a join. The transaction the write paths already run covers the write; the cost is on issuance's hot path and stays there.
- The shape is enforced by composite foreign keys and two deferred constraint triggers rather than by declarative constraints alone, which is more database machinery than the previous shape carried, and it is the price of the invariant being real.
- The migration is destructive and no-rollback (ADR-024): after it, a previous application version cannot insert a credential. The v0.5 release notes must carry the marking.
- Pre-capture rows read `EXTRACTION_PENDING` until the operator-run backfill (#953) reaches them. The window is real and operator-controlled, and the backfill job is built to keep it short.
- The capture adds work to the issuance write path. It is one read of an artefact already in hand and a few columns in a write that already happens, but it is on the hot path and stays there.

## Alternatives considered

**One `LibraryRecord` table everything is copied into** (the tempting shape above). Rejected. Every issuance would write twice, and a partial failure leaves a library that lies about what was issued. The copy also has to be kept in step with every later change to the credential row, which is a second synchronisation problem on top of the first.

**One shared table for both origins instead of two.** Rejected. The two origins share almost no custody columns, so a shared table is two tables interleaved, with every constraint weakened to "unless the other origin". The parent holds only what both origins share by construction; the conditionality stays out.

**Two record tables with no parent, and an exclusive pair of foreign keys on every referencing table** (this ADR as first accepted, and the first implementation chunk of #955). Replaced by the amendment. Adequate at two origins, but it declares the extracted columns and their query paths twice, every new origin touches every referencing table, and the list becomes a union of two shapes. The change was made before any deployment held the tables, so it moved nothing anyone depends on.

**A single id plus a kind column on the referencing tables.** Rejected. The database cannot enforce a conditional foreign key, so the reference would be a bare id with no integrity and no cascade.

**Use the credential document's own id as the record id.** Rejected. The id inside a credential is the issuer's claim, in the issuer's namespace. Two issuers can collide, a malicious document can choose its id, and we would be building lookups on an identifier we do not control. Our records are keyed by ids we mint.

**Read descriptive fields from the stored artefact at query time instead of capturing them.** Rejected. The list would fetch and decrypt an artefact per row per page, turning every list call into a fan-out of storage reads, and an encrypted artefact whose key is absent could not be listed at all. Capturing at issuance reads the artefact once, when it is already in hand and open.

## Not decided here

- How a `pending` generation is worked, claimed, and recovered after a crash. ADR-054 decides it.
- Who holds keys for external credentials, and what the record looks like while a credential is held but unopened. ADR-055 decides it; the `hasKey` state named above is defined there.
- How a retried registration is kept from creating two records. ADR-051's idempotency claims guard it; the `Idempotency-Key` header is required on register.
- Whether a duplicate-detection digest should also match a tenant re-registering a credential it issued itself. Open; it needs the native issuance digest computed canonically first.
- Per-tenant storage quotas for durable copies. Tracked separately.
- The registered-data-model fallback for an external record's core kind (decision 8), and where the list's indexes for its issuer and date filters are tuned. #962 owns both against the real list query.

## References

- ADR-052 — the surface this record model serves.
- Epic #950 — the library's scope and decomposition; #952 and #953 carry the capture and the backfill, #955 the registration that creates external records, #957 re-verification.
- ADR-043 — the operator-run backfill conventions #953 follows.
- ADR-037 — Zod at the inbound boundary; decision 7 applies the same library outbound.
- ADR-051 — the idempotency claims that guard registration.
- #980 — the issue-time capture decision 5 first shipped onto the `Credential` row; the amendment moves it to the parent.
- `documentation/docs/reference-implementation/api/data-models.md` — extension data models and their core parent, behind decision 8.
