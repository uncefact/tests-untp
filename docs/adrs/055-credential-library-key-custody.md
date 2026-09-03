# ADR-055: We never keep a supplier's key; the copy we keep is protected by a key we made

- **Date:** 2026-08-31
- **Status:** accepted
- **Update (2026-09-03):** Decision 2's write side is enforced by the type system. `protectDecryptionKey` returns a branded `ProtectedDecryptionKey` (`src/lib/credentials/decryption-key-protection.ts`), and the two repository create inputs that write a key column, native issuance and external registration, accept that type and nothing else, so an unwrapped key cannot reach a key column through a repository. The brand stops at that boundary, so writes made through the Prisma client directly, and the key-lifecycle stores that rotate and audit those columns, still take plain strings.
- **Update (2026-09-02):** Every column encrypted under `DATA_ENCRYPTION_KEY` is tagged `@encryptedAtRest` in `schema.prisma`, listed in `src/lib/credentials/envelope-stores.ts`, and read and written through the Prisma adapter in `src/lib/credentials/prisma-envelope-stores.ts`; a unit test holds the tag set and the adapter equal. The audit, the rotation, the startup validation and the backfill preflight walk that list through the store interface, so a column added to the list is covered by every key-lifecycle operation at once; only the adapter and the backfill's wrap pass, which writes the credential column directly, touch the ORM. Before this, each operation enumerated the stores by hand and the idempotency replay body was missing from all of them. The external credential key this ADR decides joins the list with the library schema (#955).
- **Update (2026-09-01):** ADR-054 supersedes this ADR's statement that key-bearing recovery runs on the job substrate as a non-retryable task. Work that needs a caller-supplied key now runs inside the request that carried the key and is never enqueued, because the queue's payloads never carry key material. The custody rules themselves (the key is never persisted; failure names a resume code) are unchanged.

## Context

Some credentials are encrypted, and an encrypted credential is only as useful as the key that opens it. The library (ADR-052) holds credentials of two origins, and the key question is different for each.

For a **native** credential the answer already exists. At issuance the storage service encrypts the artefact and hands back the key, and we store that key on the `Credential` row, encrypted at rest. The detail route returns it to the tenant. The key was ours from the moment it existed, and nothing in the library changes that.

An **external** credential arrives the other way around. Its supplier encrypted it, so the key exists before we ever see the credential, it belongs to someone else, and it reaches us, if it reaches us at all, as part of a registration request. Sometimes it does not arrive at all: a supplier sends the credential's location first and the key later, or never.

Whatever we do with that key is a custody decision with long consequences. A key we store is a secret we now own: it needs protection, it appears in backups, it has to be considered in every export and every breach conversation, and the supplier who minted it has no idea we kept it. A key we merely use and forget is none of those things, but then a crash at the wrong moment, or a key that never arrives, must leave the record in a state that is still honest and still recoverable.

So the question is: who holds the keys that open what the library keeps?

## Decision

1. **A supplier's key is used and forgotten. It is never stored, and no response ever returns it.**
   A key supplied on a request lives in memory for the life of that request. We use it to open the artefact, and then it is gone. What we never take on: custody of another party's secret, its rotation, its audit trail, or the ability to leak it.

2. **The copy we keep is protected the native way: our storage service encrypts it and we hold the key it returns.**
   Once an external credential is opened, its plaintext goes to our storage service, which encrypts it and returns a receiver-side key. From there the record behaves exactly like a native one: the key is ours, stored encrypted at rest, and returned on the detail route.

3. **A credential can be registered before its key arrives. We store the ciphertext exactly as fetched and say so.**
   The as-fetched bytes are kept unmodified as the durable copy. No new key is minted for them, because wrapping bytes we cannot read in our own encryption would dress the copy up as something we can vouch for, and we cannot: we attest nothing about the supplier's encryption. The record carries `hasKey: false`, and its verification result says honestly that the credential could not be opened.
   This is the durability bet: the supplier disappearing later is exactly the situation keeping a copy exists to survive, so a missing key must not block registration.

4. **A late key opens the stored copy, never a fresh fetch, and the raw copy is then replaced by a protected one.**
   The key arrives through re-verification of the existing record (#958). It is applied to the ciphertext we already hold, because the source may no longer exist, which is the point of holding a copy. On success, the opened content goes through decision 2, and the replacement copy and the custody state that records it are committed in one database transaction, so a crash always leaves the record either still unopened or fully protected, never half way.
   A key that does not work fails that verification with a wrong-key code, distinct from the no-key code, and the ciphertext is kept for the next attempt.

5. **Key material appears on the detail route and nowhere else, and the detail route tells the truth about the in-between states.**
   List and bulk responses never carry a key or a storage location, for either origin. The detail route returns the receiver-side key and the location for a protected copy; for a held-but-unopened record it returns the location with a `null` key; for a record with no durable copy yet, both are `null` (#964). A consumer can always tell "openable" from "held but unopened" from "not yet copied", without us ever handing out a key we do not own.

6. **Work that still needs a caller's key cannot be retried by the system. It fails, and says how to resume.**
   Because of decision 1, a crash destroys the only copy of a supplied key we ever had. Background work is retried by the job substrate (the background-work ADR in this set), but a key-bearing task is registered as non-retryable: it settles failed with a code telling the caller to send the key again, and decision 4's transaction guarantees the resend finds the record in a state where sending it again works, as a key-bearing re-verification of the existing record, never a second registration.

7. **Nothing here is an issuer-trust claim.**
   Registering, keeping a copy, and re-verifying are operations we define for ourselves. Verification covers fetch, decryption where needed, digest, JOSE proof, status, and validity dates, and schema conformance advisorily. No check asserts that the issuer is who the credential says it is, or that the issuer is trusted; that is a different capability, deliberately not smuggled in through custody.

## Consequences

Positive:

- We hold no secrets we did not mint. Every key in the database is one our own storage service issued, under the protection native keys already have.
- A tenant can register what it received the moment it receives it, key or no key, and nothing is lost if the supplier is never heard from again.
- Export rules stay simple for the client to enforce: the only keys a tenant can ever see are its own, so "your key to share, theirs is not yours to pass on" falls out of what the API returns rather than needing server policy.

Negative:

- A caller whose key-bearing request is interrupted must send the key again. That is the price of decision 1, and we pay it knowingly.
- An unopened stored copy is the supplier's ciphertext at a fetchable location for anyone who holds its unguessable URI. That is the same exposure the source itself had, not a new class, and we accept it rather than pretend our wrapping would add protection we cannot attest.
- "It is stored" and "it is protected" are different states a consumer must read (`hasKey`, and the detail route's null states), and every screen showing external credentials has to present that difference honestly.

## Alternatives considered

**Keep the supplier's key so we can re-decrypt whenever we need to.** Rejected. Once the protected copy exists there is nothing left to re-decrypt: the stored copy opens with our key. Keeping theirs as well is pure liability, a second secret with custody, rotation, and breach obligations, guarding nothing.

**Refuse to register an encrypted credential until its key is present.** Rejected. It makes registration depend on the supplier's timing, and the credential's source can vanish while the tenant waits. Store the ciphertext, say it is unopened, accept the key whenever it comes.

**Fetch the source again when the key finally arrives.** Rejected. The stored copy exists precisely because the source may be gone, and re-fetching would also verify different bytes than the ones we digested at registration. The key opens what we hold.

**Wrap the unopened ciphertext in our own encryption anyway.** Rejected. It changes nothing real, the content is still unreadable without the supplier's key, and it makes the record look protected by us when it is not. `hasKey: false` must mean what it says.

**Persist a supplied key just long enough to survive a crash mid-task.** Rejected. However short the window, it is stored key material, with everything decision 1 exists to avoid. Failing the task and asking the caller to resend costs one request in a rare moment, and keeps "we never store your key" a sentence with no footnotes.

## Not decided here

- Where and how the background work that uses these keys runs. The background-work ADR in this set decides the substrate; decision 6 only registers the non-retryable class with it.
- Duplicate detection for a record whose content only becomes readable after a late key. The advisory-warning shape ships with #956; the open native-cross-match question stays open there.
- Per-tenant storage quotas for durable copies, opened or not. Tracked separately.

## References

- ADR-052 — the surface these routes live on.
- ADR-053 — the record model; `hasKey` and the custody state live on the external record it defines.
- #955 — registration, including the register-without-a-key branch.
- #957, #958 — re-verification, and supplying a key later against the stored copy.
- #964 — the detail route's key and null-key read states.
