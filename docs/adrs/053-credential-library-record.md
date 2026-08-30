# ADR-053: A library record is a view of what we have, not a copy of it

- **Date:** 2026-08-25
- **Status:** proposed

## Context

The library (`/api/v1/library`, ADR-052) lists everything a tenant holds: **native** credentials the tenant issued through this system, and **external** credentials other parties issued and sent to the tenant out of band. This ADR decides what a row in that list actually is.

Native credentials already live somewhere. Issuance writes a row to the `Credential` table (`prisma/schema.prisma`), and the storage service holds the signed artefact durably. The row carries the storage location, the digest, the decryption key, and the links to the tenant's master data. Nothing about that changes.

External credentials have nowhere to live at the moment. Registering one fetches it from its source and stores a durable copy, and the record has to remember what only an external credential has: where it came from, where our copy is, and whether we hold a key that opens it.

Registration also verifies the credential, and verification is never a once-only fact. A result is true of the moment it ran: a revocation made directly against the verification service only shows up the next time someone checks. So a credential of either origin can be re-verified at any time, an external one to reconfirm what registration found, a native one to catch a status change made out from under us.

That means a record of either origin gathers verification results over time, each one a fact about the moment it ran, with a newer result superseding an older one rather than rewriting it.

The tempting shape is one new `LibraryRecord` table that everything is copied into: issuance inserts a library row next to its credential row, registration inserts one for each external credential, and the list reads one table. One table, one query, done.

So the question is: is a library record its own copy of the data, or a view over where the data already lives?

## Decision

1. **A native credential's library record is the `Credential` row, read in place. Nothing is copied.**
   Its library id is that row's own database id, the same id the rest of the API already uses for it. It is never the id written inside the credential document itself; a document's self-asserted id is the issuer's claim, not our identity for the row.
   The reason there is no copy: a copy must be written every time issuance writes, and the first time one write succeeds and the other fails, the library disagrees with issuance. A row that is read in place cannot disagree with itself.

2. **An external credential's library record is its own row, in its own table.**
   It is created at registration, and its id is minted then, opaque, by us. The row holds what only an external credential has: the source URL it was fetched from, the location of our durable copy, and whether we hold a key that opens it.
   It is not a column-extended `Credential` row. Almost nothing carries across: publication state and master-data links mean nothing for someone else's credential, and source and custody mean nothing for our own. One shared table would make every rule on it conditional on origin. Two tables keep each side's rules unconditional, and the list joins them.

3. **Verification results are a third table: one row per generation, belonging to exactly one record.**
   A generation row points at its parent through two foreign keys, one to each record table, with a database rule that exactly one is set. The database enforces the relationship; we never join through a bare id column that both tables' id spaces could collide on.
   Generations are numbered from 1 and only ever added. What that buys is ordering: a stale result can never overwrite a newer one, and two verifications racing each other cannot corrupt the record's answer. Nobody has asked for the past results as a feature; the surface only ever shows the current one. Keeping them is a side effect of append-only being the simplest safe shape, and deleting a record cleans its generations away with it.

4. **Generation 1 means a different thing for each origin, and the record says so honestly.**
   An external record's generation 1 is a real verification: the whole point of registering is to check a credential we did not make.
   A native record's generation 1 is an issuance assertion, not a verification. Issuance signs and stores the credential; it does not run the verification pipeline over the finished artefact. The assertion records that, and no more: the checks that need an external source are marked as not run, and the proof check reports what actually happened, which is that we signed it ourselves moments earlier.
   From generation 2 onward, both origins are the same: a re-verification really runs the pipeline. That is how an out-of-band revocation of a native credential becomes visible here.
   The distinction is kept visible on every surface. A consumer can always tell "this system vouches for what it did" from "this system checked".

5. **The descriptive fields the list needs are captured onto the credential row at issuance, inside the same database write that creates the row.**
   This one is already in use rather than proposed: #980 shipped it, and this records the shape. The list shows a credential's name, issuer, subject, and validity dates without opening the stored artefact. Those fields are read out of the signed artefact at issuance time and written in the same persist as the credential row itself, on the code path every way of issuing passes through. No entry point can create a credential without its captured fields, today's single issue call or any future batch path.
   The capture reads the signed artefact, not the request. If signing fails, nothing is captured and issuance fails exactly as it does today.
   The row says how the capture went. `detailsStatus` is `EXTRACTED`, `EXTRACTION_PENDING` (the default every pre-capture row wears until the operator-run backfill reaches it), or `EXTRACTION_FAILED`, and a failure records why (`detailsError`: an unreadable envelope, a bridge error, a failed decrypt), so a later run knows which failures a code fix or a restored key makes worth retrying, and a reader can tell "not yet extracted" from "this credential has no such data".

6. **Every record carries capability flags, so a consumer never re-derives our rules.**
   `deletable`, `annotatable`, and `verifiable` are present on every record, computed by us from origin and custody state. A screen decides what buttons to show by reading them, not by re-implementing the rules behind them.
   `verifiable` is also a seam. It is always `true` in v1; the future document mode from ADR-052's transition, a received PDF held in the library, would be the first record to carry `false`. That mode rests on two things nobody has checked against source, whether the storage service accepts a binary payload on both its public and private endpoints, and whether a private-bucket object is fetchable by anyone holding its URI and key, and the ticket that scopes it checks both before building.

7. **An envelope's legal shapes are enforced where envelopes are built, at runtime, by one schema that also generates the published contract.**
   An envelope in a given state may only carry certain fields, and the published OpenAPI schema says so, but a schema constrains documents; it cannot stop a server emitting a bad one. So every envelope is built through one constructor per state, those constructors are the only place envelopes are built, and each checks its inputs at runtime with a Zod schema, the same library ADR-037 uses at the inbound boundary, applied outbound. An illegal combination fails where someone tried to build it, before it can become a response.
   That Zod schema is the single source of truth: the published OpenAPI component is generated from it, through the generation path the repository already has, and it ships with whichever library route first returns an envelope. The contract and the enforcement cannot drift, because they are one artefact.

## Consequences

Positive:

- The library cannot drift from issuance, because for native credentials there is nothing to drift: it reads the same row.
- Each origin's table stays simple. No column is "only meaningful when...".
- Verification history is append-only and referentially sound, and the honesty line between vouching and checking is structural, not a convention.
- The list is cheap. It reads captured columns and joins two tables; it never opens a stored artefact to answer a query.

Negative:

- The list is a join over two differently-shaped tables, and the surface has to present them as one row shape. That mapping code is the price of unconditional tables.
- Pre-capture rows read `EXTRACTION_PENDING` until the operator-run backfill (#953) reaches them. The window is real and operator-controlled, and the backfill job is built to keep it short.
- The capture adds work to the issuance write path. It is one read of an artefact already in hand and a few columns in a write that already happens, but it is on the hot path and stays there.

## Alternatives considered

**One `LibraryRecord` table everything is copied into** (the tempting shape above). Rejected. Every issuance would write twice, and a partial failure leaves a library that lies about what was issued. The copy also has to be kept in step with every later change to the credential row, which is a second synchronisation problem on top of the first.

**One shared table for both origins instead of two.** Rejected. The two origins share almost no columns, so a shared table is two tables interleaved, with every constraint weakened to "unless the other origin". The join the list needs is cheaper than the conditionality everything else would pay.

**Use the credential document's own id as the record id.** Rejected. The id inside a credential is the issuer's claim, in the issuer's namespace. Two issuers can collide, a malicious document can choose its id, and we would be building lookups on an identifier we do not control. Our records are keyed by ids we mint.

**Read descriptive fields from the stored artefact at query time instead of capturing them.** Rejected. The list would fetch and decrypt an artefact per row per page, turning every list call into a fan-out of storage reads, and an encrypted artefact whose key is absent could not be listed at all. Capturing at issuance reads the artefact once, when it is already in hand and open.

## Not decided here

- How a `pending` generation is worked, claimed, and recovered after a crash. ADR-054 decides it.
- Who holds keys for external credentials, and what the record looks like while a credential is held but unopened. The custody ADR in this set decides it; the `hasKey` state named above is defined there.
- How a retried registration is kept from creating two records. ADR-051's idempotency claims guard it; the `Idempotency-Key` header is required on register.
- Whether a duplicate-detection digest should also match a tenant re-registering a credential it issued itself. Open; it needs the native issuance digest computed canonically first.
- Per-tenant storage quotas for durable copies. Tracked separately.

## References

- ADR-052 — the surface this record model serves.
- Epic #950 — the library's scope and decomposition; #952 and #953 carry the capture and the backfill, #955 the registration that creates external records, #957 re-verification.
- ADR-043 — the operator-run backfill conventions #953 follows.
- ADR-037 — Zod at the inbound boundary; decision 7 applies the same library outbound.
- ADR-051 — the idempotency claims that guard registration.
- #980 — the shipped issue-time capture decision 5 records.
