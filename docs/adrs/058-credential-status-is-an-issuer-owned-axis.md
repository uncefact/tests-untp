# ADR-058: Credential status is an issuer-owned axis, separate from verification

- **Date:** 2026-09-16
- **Status:** accepted (2026-09-17)
- **Update (2026-09-17):** The issuance default is now a deployment setting, `DEFAULT_STATUS_PURPOSES`; the ADR body is unchanged.
- **Update (2026-09-17):** The issuance-capture change (#716) records status purposes and issuer-service attribution at issuance, captures the returned signed entries in the parent and child transaction, exposes status facts on native library records, and provides operator-run capture and attribution backfills. Provider mutation routes and lifecycle presentation follow in the status-mutation change (#490).
- **Update (2026-09-17):** Newly issued credentials carry `statusListIndex` as a specification-defined decimal string; previously issued numeric indexes remain readable.
- **Update (2026-09-17):** Newly issued credentials carry `statusListIndex` as an integer to match the published UNTP v0.7.0 schemas. Parsing and capture retain the canonical decimal-string index in stored `CredentialStatusEntry` rows; revert the issued value to the specification's string in base 10 when the UNTP schema is corrected upstream.
- **Update (2026-09-17):** The supported-purposes list is Reference Implementation policy, not part of the `packages/services` contract.
- **Update (2026-09-17):** The status-list mutex is transaction-scoped on the shared application pool, so it remains effective through transaction pooling while holding one pool slot for the provider call.
- **Update (2026-09-17):** Entries with `statusSize > 1` are refused during capture as `MALFORMED_ENTRY` rather than captured, per the disposition record.
- **Update (2026-09-17):** Native issuer-status set, read and reconcile routes now expose fenced observations, with a grace window and explicit provider-change acceptance. Library lifecycle and management capability are independent of verification; pending and differing observations are warnings. Configuration repair preserves original pins and records accepted replacement digests. The shared mutex uses two signed 32-bit SHA-256 words, and loss of its transaction during a set retains pending intent as an unknown outcome. The ADR body is unchanged.

## Context

Every credential the Reference Implementation issues carries a W3C Bitstring Status List entry, minted by the verifiable credential service at signing time. Nothing after issuance can read or change that entry. The coordinates that identify it (the list URL, the index, the purpose and the issuer) exist only inside the signed artefact, and the `Credential` row records neither them nor which service instance signed. A verifier that checks a shared credential sees a status failure only when the bit is set, and today nothing in this system can set it.

Three facts about the substrate shape the decision. VCKit 1.2.1, the bundled provider, exposes `setBitstringStatus` and `checkBitstringStatus` agent methods. Its setter locates the list by URL, issuer and purpose and rewrites the whole encoded list, and a probe on 2026-09-16 showed that concurrent sets on one list lose bits (two parallel sets kept one, four kept one). Its verifier fails a credential on any set bit whatever the entry's `statusPurpose`, so a `message` bit set through it invalidates the credential for every VCKit-based verifier, and its reader answers `revoked: true` with an `errors` array on four failure paths (list unreachable, list verification failed, purpose mismatch, issuer mismatch) as well as when the bit is set.

The library already records a per-generation verification result (ADR-053) and derives `verification.summary` from published checks; its schema refines that the summary equals the derivation. A revocation this system performs must be visible on the library record at once, without waiting for a worker to observe it, and it must not be written into a verification generation that never ran.

## Decision

1. **Status entries are captured from the signed artefact and persisted per credential, and a capture failure never blocks issuance.** The caller is told through the issuance response, and the row records why, so the credential exists and is readable while unmanageable until the capture is repaired. A `CredentialStatusEntry` row per entry holds the original descriptor, the canonical decimal-string index, the list URL, the issuer, the last confirmed value and when it was observed. Uniqueness is `(credentialId, statusPurpose)`, a property of this system's own issuance path rather than a rule of the standard; a signed artefact with two entries of one purpose fails capture explicitly. Existing records are backfilled by an operator-run command under ADR-043, because the backfill reads the storage service.

2. **The issuing service instance is recorded at issuance, and a historical record is attributed by an operator, never inferred.** A public read of the list proves readability, not ownership. Without a recorded or attributed instance a credential is readable but not mutable.

3. **Purposes are open in the data model and bounded at the boundaries this system controls.** Any purpose found in an artefact is captured as a fact. This system mints `revocation` and `suspension` only; the status-mutation change (#490) will accept those purposes only. Every other purpose, including `message` and `refresh`, is refused at issuance and mutation because the bundled provider treats every set bit as invalidating (probe, 2026-09-16), so no other purpose can be offered with its specified meaning. Entries whose `statusSize` exceeds one bit are captured but never mutated; the provider's setter handles one bit. Only revocation and suspension carry lifecycle meaning.

4. **When a caller omits `statusPurposes`, issuance mints `revocation` only** (Ashley, 2026-09-16, on the evidence that the shipped UNTP 0.7.0 core schema references a single `credentialStatus` object); dual-purpose issuance is an explicit request whose credentials carry an array and a documented schema-conformance advisory.

5. **Revocation is irreversible at this system's mutation boundary.** The status-mutation route (#490) refuses an un-revoke before any provider call, and will treat `refresh` the same way, because the specification says both are not reversible. The issuance-capture change (#716) does not expose mutation routes.

6. **A status change is provider first, read-back second, commit third, with durable intent in between and no worker.** This is the design of the status-mutation change (#490). The row records the requested value, a deadline and a fencing token before dispatch; one abort signal derived from that deadline bounds every provider call in the operation; a read is an observation only when the provider reports no errors; success requires the read-back to equal the request; the commit is conditional on the token (which fences this system's persistence, not the provider), the version and an unchanged provider configuration. Every other outcome is a non-200 that states what is and is not known. An uncertain outcome is cleared only by an explicit reconcile once the deadline plus a grace period has passed; the same reconcile, on an entry with no pending intent, is the first observation of a backfilled entry, under the same version precondition and a revalidated provider identity. The residual that remains is stated rather than hidden: a request the provider had already accepted can still be applied after the deadline.

7. **Provider list writes are serialised inside this deployment, and the limit of that is stated.** Minting takes a transaction-scoped advisory lock keyed by the provider's canonical status serialisation key on a dedicated connection held for the provider call, with bounded acquisition. The status-mutation change (#490) uses the same lock, and mutation will be enabled only where the operator attests this database is the sole writer to that provider for that issuer. This serialises only participating operations that share this database; it does not serialise other clients of the same provider, and it does not establish that an uncertain provider request has stopped. The durable fix is in the provider. The limit, stated plainly: RI locking serialises participating operations sharing one coordination database and canonical provider/list identity. It does not serialise other VCKit clients or establish that an uncertain provider request has stopped.

8. **Issuer status is a second axis on the library record, and verification is never rewritten from it** (Ashley, 2026-09-16, choosing independent axes over a combined summary). The status-mutation change (#490) gives the record the entry facts and a derived `lifecycle` (`revoked`, `suspended`, `none`, `unknown`), filterable independently of `?status=`, which keeps its verification meaning. A record whose verification failed operationally and which was then revoked answers both `status=failed` and `lifecycle=revoked`. Unobserved entries contribute nothing; pending intent is a warning, not a state. A disagreement between the newest generation, only when that generation is complete and at least one lifecycle entry is confirmed, and the confirmed lifecycle facts is surfaced as differing observations with labelled timestamps, never as a claim about which observation is newer or which bit failed. The issuance-capture change (#716) exposes the captured facts only and deliberately does not expose `lifecycle`, filters or a headline.

9. **Deletion does not revoke, and a pending change blocks deletion.** A database trigger enforces the block for any application version that can reach the table.

## Consequences

Positive: an issuer can revoke and suspend what it issued; the library shows the issuer's own action at once; every promise on the wire names its evidence; the provider's failure modes are handled where they are observed rather than assumed away.

Negative: the status-mutation change (#490) adds a mandatory `If-Version` on the status route and a repair transition for a pending change whose provider configuration died; the issuance-capture change (#716) adds a transaction-scoped advisory lock in a codebase that otherwise uses transaction-scoped locks, two operator-run commands (backfill, attribution), and a `message` purpose this system cannot offer until the provider distinguishes purposes. Dual-purpose credentials are rejected by the shipped UNTP 0.7.0 core schema as an array and are reported as an advisory on re-verification.

## Alternatives Considered

**Learn the outcome of our own set by enqueuing a re-verification.** Rejected. It spends a worker job to observe a fact this system holds, and it files an issuer action as a verifier observation.

**Fold `revoked` and `suspended` into `verification.summary` and the existing `?status=` filter.** Rejected. The envelope's summary is refined from its checks and cannot carry an issuer fact without a synthetic check, and a combined filter hides a revoked record from `status=failed`, so an operator cannot find failed verification work on it.

**An operation journal with a required idempotency key.** Rejected as disproportionate. Durable intent on the entry row plus a mandatory version precondition refuses a stale retry; historical response replay is not a promise this route makes.

**Read the status by fetching and decoding the public list credential.** Rejected. The provider's singleton read answers per entry once its error array is honoured, and decoding lists here would put bitstring interpretation on this side of the adapter boundary.

**Fall back to the tenant's current primary service for a historical credential.** Rejected. A wrong instance that holds a restored copy of the same list coordinates answers successfully, so "not found fails closed" is conditional.

## References

- Issues: [#490](https://github.com/uncefact/tests-untp/issues/490), [#716](https://github.com/uncefact/tests-untp/issues/716), [#718](https://github.com/uncefact/tests-untp/issues/718), [#698](https://github.com/uncefact/tests-untp/issues/698)
- [ADR-052](./052-credential-library-surface.md), [ADR-053](./053-credential-library-record.md), [ADR-043](./043-data-backfill-conventions.md), [ADR-037](./037-input-validation-zod-route-boundary.md), [ADR-024](./024-database-migration-discipline.md)
- [W3C Bitstring Status List v1.0, BitstringStatusListEntry](https://www.w3.org/TR/vc-bitstring-status-list/#bitstringstatuslistentry) (purposes, reversibility, decimal-string index)
- [VCKit 1.2.1 bitstring status list plugin](https://github.com/uncefact/project-vckit/tree/1.2.1/packages/bitstringStatusList) (setter rewrites the whole list; reader fails on any set bit)
- Probe of 2026-09-16 against VCKit 1.2.1: the findings are summarised in Context above (concurrent sets lose bits, every set bit fails verification, string index rejected on set).
