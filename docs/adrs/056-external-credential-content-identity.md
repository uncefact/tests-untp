# ADR-056: An external credential's identity in the library is its signed content, held once per tenant

- **Date:** 2026-09-07
- **Status:** accepted

## Context

Registering a credential received from a third party (ADR-052, ADR-053) takes a URL and produces a library record with a durable copy. Nothing stopped a tenant registering the same credential twice: two URLs serving one signed credential, a supplier re-sending a location, or an integration retrying under a fresh idempotency key each produced a second record with its own copy, its own verification history and its own key custody. The library then held two records that claimed to be one credential, and every consumer of the list, the detail route and the verification history had to guess which one was real. ADR-053 and ADR-055 both left the question open, and #956 is the ticket that closes it, so the record-level shape has to be decided before #957 (re-verification, which recovers copies and so meets the same question) and #960 (deletion, which has to say what happens to the identity a deleted record held) can build against it.

The forces are these. Identity has to survive the ways one credential can arrive differently: a pretty-printed wrapper, a wrapper whose `@context` is a string rather than an array, an encrypted envelope opened with the supplier's key, or a different hosting URL. It has to be enforced where two concurrent registrations meet, which is the database, not the request. It must not require reading back the durable copy, because a copy that failed to store, or one whose only readable form arrived encrypted, still has to be able to hold or contest an identity. And the older records in a deployment were registered before any identity was computed, so a rule that depended on them having one would be wrong from the first day.

## Decision

1. **The identity of an external credential is the digest of the accepted signed JWT's exact text.** The register path already decodes an enveloped credential's compact JWT segment (`decodeCredential` in the services package); the identity is the sha2-256 multihash of that segment, base58btc encoded, computed by `contentDigestOf` in `src/lib/library/content-digest.ts`. The wrapper around the JWT is not part of the identity, so a pretty-printed or differently-shaped envelope of one credential matches, and an encrypted copy that opens to the same credential matches. Two spellings of one JWT that a verifier would both accept (trailing whitespace, signature padding) are two identities, because the rule is the bytes the credential was accepted as, not its decoded meaning. A body that is not an enveloped credential (an HTML page, a plain JSON object, ciphertext no key opened) has no identity and is never a duplicate of anything.

2. **The identity is held on the record, unique per tenant, and enforced by the database.** `ExternalCredential.contentDigest` carries it, under a partial unique index on `(tenantId, contentDigest) WHERE contentDigest IS NOT NULL` (migration `20260906000000_external_credential_content_identity`). The request checks for a holder before it stores a copy, so the ordinary duplicate is refused cheaply, but the index is the authority: two registrations that both miss the check and race to insert are settled by the index, and the loser's unique violation is mapped to the same rejection. A record holds its identity whatever state it is in. A copy that failed to store, or a credential whose details could not be extracted, still blocks a fresh registration of that credential, because the identity is a property of what was read, not of what was kept.

3. **A duplicate is refused with `409 DUPLICATE_CREDENTIAL` naming the record that holds the identity, and the request's idempotency claim is released.** The response carries a `Location` to the holder. No record and no generation are created. The claim (ADR-051) is released rather than consumed, so the caller may reuse the key once the duplicate is resolved, which is the same treatment every rejection that writes nothing receives. A request that loses the race after storing its copy leaves that copy orphaned in the storage service, and the rejection is logged with the copy's coordinates for the operator.

4. **A record that arrives at an identity someone else already holds, outside a registration request, points at the holder instead of holding a second copy of the identity.** `ExternalCredential.duplicateOfRecordId` references the holder by `(id, tenantId)`, and a check constraint forbids a row carrying both a digest and a pointer. Registration never writes the pointer; it refuses instead (decision 3). The pointer exists for #957's recovery, which re-reads a copy for a record that already exists and cannot refuse a record that is already there, and the detail route projects it as a `DUPLICATE_CONTENT` warning. No shipped version writes it yet.

5. **When a holder gives up its identity, the oldest record pointing at it becomes the holder, and the others are repointed.** `promoteExternalCredentialDigest` releases the holder's digest, promotes the oldest advisory row pointing at it, and repoints every remaining advisory row of the former holder to the promoted one, in the caller's transaction. It is the single path for #960's delete and #957's content change, so the identity never becomes unheld while a record still carries the content. The caller must delete or change the former holder in the same transaction, and a writer attaching a new pointer must revalidate under its own lock that the target still holds the digest it observed, because a promotion may have moved it. Deleting a holder with no advisory rows simply frees the identity; the composite foreign key nulls only the pointer column (`ON DELETE SET NULL ("duplicateOfRecordId")`, a PostgreSQL 15 form), never the tenant.

6. **Records registered before this decision are not backfilled.** They carry no identity, so a later registration of the same credential is not refused against them. Computing their identity would mean reading every stored copy back, including copies whose key is not held, and a partial backfill would refuse some duplicates and not others with no way for a caller to tell which. The rule applies from the version that ships it, and the documentation says so.

7. **Native records do not participate.** A credential the tenant issued itself has its own digest computed by the storage service over the artefact as stored, which is a different preimage from decision 1, so a native record and an external registration of the same signed credential do not match. Whether they should is the open question ADR-053 records, and it stays open here.

## Consequences

Easier: a tenant holds one record per credential it received, the list and the detail route stop having to arbitrate between twins, and the answer to "is this already registered" is a single indexed lookup. #957 and #960 have a defined shape for the cases where an identity moves between records. The rejection tells the caller exactly which record to look at.

Harder: the identity is the accepted bytes, so a supplier that re-signs or re-encodes a credential produces a new identity, and an integrator who expects semantic matching will be surprised; the API documentation states the rule. A race loser leaves an orphaned copy in the storage service that only the operator's log points at. Two database objects live only in migration SQL (the partial index and the column-specific foreign key), so `prisma migrate dev` proposes dropping them and the maintainer has to read the generated SQL. The deployment floor rises to PostgreSQL 15. Non-credential bodies have no identity, so an HTML page registered twice is two records, by design.

## Alternatives considered

- **Identity as a digest of the decoded credential document (semantic identity).** Rejected. The decoded document is a projection of the signed bytes, and two projections of one signature can differ by serialisation choices the library does not control, which puts the matching rule inside the JSON-LD and canonicalisation layer and makes it version-dependent. The signed bytes are what the supplier committed to and what a verifier checks.

- **Identity as the storage service's digest of the durable copy.** Rejected. That digest covers the copy as stored (the wrapper, or the ciphertext's decrypted form), so one credential under two wrappers has two digests, and a record whose copy failed to store has no digest at all and could never hold or contest an identity.

- **A unique constraint with nulls not distinct, or a plain unique index.** Rejected. A plain unique index already allows many nulls, and the partial predicate makes the object's intent explicit: only rows that hold an identity compete. Nulls-not-distinct would forbid the many identity-less rows the library legitimately holds.

- **Refusing the duplicate in the request only, without an index.** Rejected. Two concurrent registrations both miss the check and both insert, which is exactly the twin this decision exists to prevent. The request-time check remains as the cheap path.

- **Consuming the idempotency claim on a duplicate rejection.** Rejected. Every other rejection that writes nothing releases the claim (ADR-051), and a consumed key would force the integrator to mint a new one to register the credential after deleting the holder, for no gain in safety.

- **Backfilling identities for existing records.** Rejected for the reasons in decision 6.

- **Storing the digest on advisory rows as well, with a non-unique index.** Rejected. Two rows holding one identity, one canonical and one not, need a second column to say which is which, and every reader then has to join on it. The pointer says the same thing with one column and lets the database enforce that a row is one or the other.

## Not decided here

- Whether a native credential and an external registration of the same signed credential should match (ADR-053's open question). It needs the native identity computed over the same preimage first.
- The identity of a credential whose content only becomes readable after a late key arrives. The advisory pointer is the shape it will use; the writer lands with #957.
- What the operator does with the copy a race loser orphans. The log names it; nothing reclaims it.

## References

- #956, the ticket; epic #950.
- ADR-051 (idempotency claims), ADR-052 (the library surface), ADR-053 (the library record; its open native-match question), ADR-055 (key custody; its late-key duplicate question).
- Migration `20260906000000_external_credential_content_identity`; `src/lib/library/content-digest.ts`; `promoteExternalCredentialDigest` in `src/lib/prisma/repositories/external-credential.repository.ts`.
- API documentation: `documentation/docs/reference-implementation/api/library.md`, the registration section.
- PostgreSQL 15 release notes, column-specific `ON DELETE SET NULL`: https://www.postgresql.org/docs/15/sql-createtable.html
