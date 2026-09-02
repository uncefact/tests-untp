# ADR: An idempotency key is claimed before the work and owned by the request that claimed it

- **Status:** accepted
- **Update (2026-09-03):** The stored response body is one of the columns the key lifecycle covers: `rotate:encryption-key` re-encrypts it with the other stores and `audit:encryption` reports it. It is the one discardable store: a body that is damaged or opens under neither key never blocks a rotation or a backfill, never counts as proof that the configured key is right (it may predate a rotation), and is never sampled at startup; a rotation clears such a body and keeps the claim. While the unreadable body remains, a retry is answered with the recorded credential and a warning that the body was lost; once cleared, with the credential alone. Never with a second issuance. The claim row itself is never deleted by the lifecycle. The store list and the rule live in `src/lib/credentials/envelope-stores.ts`.

## Context

#954 adds an `Idempotency-Key` header to credential issuance so a pipeline that retries after a timeout gets its original credential back instead of a second one. #955 needs the same guarantee for registering a received credential, and the two must not invent it separately, so the rule is recorded once here.

Issuance is not a database write that can simply be repeated. `POST /api/v1/credentials` signs the credential with the VC service, which mints it upstream and consumes a status-list position, stores it with the storage service, and only then writes the `Credential` row. A caller whose connection drops after signing cannot tell whether any of that happened, and its retry produces a second, equally valid credential with a different id. Library registration has the same shape: it fetches a remote artefact, stores a durable copy, and writes a record.

A first implementation guarded this with a single row per key, and a review of it found three ways the guarantee still failed. A request slow enough to be considered abandoned could return and overwrite, or delete, the row belonging to whichever request had since taken the key. A crash between writing the credential and recording it against the key left a credential no retry could ever find. And a retry arriving mid-flight could be handed a response the original had not finished assembling.

## Decision

1. **A key is claimed by inserting a row, before any irreversible work.** The claim is a row in a per-key table with a unique index on `(tenantId, operation, key)`, inserted after the request has been validated and immediately before signing, or before fetching in the case of registration. That unique index is what serialises two concurrent claims for the same key on the same operation, so exactly one request proceeds and the loser is classified from the row that won. No application-level locking is involved.

2. **Every claim carries an owner token, and completion and release apply only to the claim that holds it.** The token is the claim row's own id, returned to the request that claimed it. Writes are conditional on it, so a request that took ten minutes and returns to find its claim reclaimed touches nothing rather than overwriting or deleting the row that now belongs to another request. Without this, wall-clock reclaim and unconditional writes combine to mint two credentials and leave the first unreachable.

3. **The credential and its association to the key are written in the same database transaction.** Recording the association as a second statement leaves a window in which a crash strands a credential that exists, is stored, and can never be replayed, which is precisely the timeout case this feature exists for. Both writes are in the same database, so one transaction covers them. The signing and storage calls before them are not transactional and are covered by rules 1 and 6 instead.

4. **A key becomes replayable only once its response has been finalised, and until then a repeat is refused with `409`.** A request in flight has a credential id recorded, by rule 3, but has not finished assembling its response, so replaying at that moment would hand back a body the original never returned. The repeat is refused with `IDEMPOTENCY_KEY_IN_FLIGHT` and the caller retries, rather than the server holding the second request open and tying up a connection for an unbounded time.

   One exception keeps a crashed request from holding a key forever. A response still unfinalised long after its credential was recorded is treated as abandoned, and the repeat replays what was recorded and marks it final, because the credential exists and must not be issued again. That replay can be missing warnings the original would have added, which is the price of not stranding the key.

5. **Replay and mismatch are decided from the stored claim before the request is validated, and the digest is taken over the raw request bytes.** Deciding first means an exact retry still returns its original response even if a data model, DID, or downstream service has since become unavailable, which is what makes the retry safe rather than merely likely to work. The digest covers the bytes as received rather than the parsed object, so two requests differing only in whitespace are treated as different bodies instead of colliding as a replay. A key reused with a different body is refused with `422 IDEMPOTENCY_KEY_MISMATCH`.

6. **An abandoned claim is reclaimable after a bounded window, but only when no credential was ever recorded for it.** Wall-clock age cannot distinguish a dead process from a slow one, so it is never sufficient on its own. A claim whose credential was recorded is never re-claimed, because that credential exists and must not be issued again; rule 4 covers what happens to it instead. Only a claim that never reached a credential may be deleted and re-claimed, which is safe for the database, though not free: a slow original may already have signed and stored an artefact, and reclaiming its key means that artefact is never recorded (see Consequences). The window is ten minutes, chosen to exceed a realistic signing and storage round trip.

   The two waits are measured from different points, because they are waiting for different things. A claim with no credential ages from when it was claimed. A recorded response that has not been finalised ages from when its credential was recorded, so a request that spent nine minutes signing is not judged abandoned a second after it finishes.

7. **The header is optional on issuance and required on library registration.** Issuance has existing callers who never send it and whose behaviour must not change, so it is additive there. Registration is new in #955, so requiring it costs no caller anything and removes the unguarded path entirely.

8. **A claim is scoped by tenant, operation and key, and the operation is a database enum.** The unique index includes the operation the key guards, so the same key string may protect two different operations independently. Without that, a pipeline that reused one key across routes would have one operation replay the other's response. The operation is an enum rather than free text because it is written by this system and never by a caller, so a value that is not a known operation is a defect rather than input to validate, and adding one is a migration someone reviews.

9. **A stored response body is encrypted at rest.** The store is shared across operations and an operation's response may carry key material, so the store protects every body rather than trusting each operation to classify its own. The envelope is AES-256-GCM, the same protection `Credential.decryptionKey` uses, so a database reader cannot recover a replayed response.

## Consequences

A retried issuance or registration returns the original response instead of producing a duplicate, and a caller that loses its connection has a way to recover the id of what it created. The guarantee is exactly one durable credential and one mapping per key. It is not a guarantee that the reply is byte-identical in every case: a response abandoned before it was finalised replays what had been recorded, without any warnings the original would have added, and a request whose finalisation failed says so through a warning that later replays do not repeat.

Signing and storage happen before the database transaction and cannot be rolled back, so at the reclaim edge an artefact can exist in the VC and storage services with no row referring to it. That happens only when a request outlives the ten-minute window and its key is taken by another, and the row is what makes a credential real to this system, so no caller is ever handed the orphan. It is logged with its storage location so an operator can find it.

A key is freed by the deletion of the credential it produced, which cascades the row away, and by a failed issuance releasing its own claim. A claim that never reached a credential is also replaced when it is reclaimed.

Each keyed request costs one small row that is kept indefinitely. There is no expiry in this version, so the table grows with keyed traffic. A key is freed only by the deletion of the credential it produced, which cascades the row away.

The guarantee holds within one database. It does not depend on the number of application instances, since the unique index does the serialising, but a deployment that ever splits this data across databases loses it.

Reclaim remains a heuristic at its edges. A request that outlives the window without recording a credential can have its key taken by another request, and both may then do work. Rule 2 ensures only one of them ends up owning the key, and rule 6 ensures the loser cannot destroy a recorded credential's mapping.

Callers gain two failure responses to handle that did not exist before, `409` and `422`, both documented on the routes that can return them.

A response body is unreadable in the database by design, so diagnosing a stuck key uses the claim's other columns.

## Alternatives Considered

**Hold the second request open until the first finishes, then replay its response.** Rejected. It ties up a connection for as long as the original takes, gives the caller no way to distinguish waiting from hanging, and needs its own timeout policy, which reintroduces the same ambiguity the caller already has. A `409` says what is happening and leaves the retry decision with the caller.

**Deduplicate on a digest of the payload, with no header.** Rejected as the mechanism, though it remains possible later as an advisory warning. Two identical issuances can be genuinely intended, so a digest alone cannot tell an accidental double submission from a deliberate second credential, and refusing the second would break a legitimate case with no way for the caller to say which it meant.

**Keep the claim in an in-memory or cache store rather than the database.** Rejected. The claim guards a credential that is durable, published and long-lived, so the record of it must be at least as durable. A store that can evict a key, or lose it on restart, silently degrades to the unguarded behaviour at exactly the moment a retry is most likely.

**Give keys a time-to-live and expire them.** Rejected for this version. An expired key silently becomes reusable, so the caller's guarantee weakens with age rather than failing loudly, and the storage saved is a few small rows. Expiry can be added later as a deliberate retention decision without changing the contract.

**Wrap the whole of issuance in one database transaction.** Rejected as impossible rather than undesirable. Signing and storage are calls to external services and cannot be rolled back, so a transaction around them would give a false impression of atomicity. The claim-then-record design exists precisely because the irreversible parts sit outside the database.

## References

- #954 for the issuance header and #955 for library registration, the two routes that share this contract.
- Epic #950 for the library surface those routes belong to.
- ADR-052 for the library surface's shape.
- ADR-036 for how a database failure reaches the caller.
