# ADR-046: The credential library is a new API surface

- **Date:** 2026-08-21
- **Status:** accepted

## Context

A credential in a tenant's hands has one of two **origins**. A **native** credential is one the tenant issued through this system. An **external** credential is one another party issued and sent to the tenant out of band, for example a conformity credential from a certifier about the tenant's own product.

Any participant in a supply chain deals in both. It issues its own credentials, and it accumulates credentials issued by others: certifications about its products, attestations from its suppliers.

Holding those external credentials matters more than it first looks. Products can be very long-lived, and the evidence gathered about them has to outlive the systems that produced it. An issuer goes out of business, a link goes dead, and the credential a tenant was handed years ago may be the only copy it will ever get. So the tenant needs its own durable copy, under its own control. A copy is not the whole answer, because checking a credential still leans on things outside it, resolving the issuer's DID and its status list among them, but without the copy there is nothing left to check at all.

One durable, queryable collection is also a foundation other things stand on. A supply-chain graph can draw on stored credentials instead of fetching every one again for every question. Provenance is answerable because everything the tenant holds is in one place. Questions like "where in this product's chain is the risk highest for this conformity topic" become askable by layers built on top. The library does not answer them; it is the shelf those layers read from.

And there is a transition coming that shapes what the collection must be able to hold. UNTP does not require every party to use verifiable credentials from day one. As supply chains adopt it, tenants will keep receiving evidence the old way: PDFs and scans, sent by email. A tenant will want those in the same library, with the same durable copy, even though they are not credentials at all. That mode is not built in this first release, but the foresight matters now, because it bears on what the surface can honestly be called.

Today the reference implementation handles native credentials only. The whole credentials surface is four routes under `packages/reference-implementation/src/app/api/v1/credentials/`:

- `POST /api/v1/credentials` issues a credential.
- `GET /api/v1/credentials` lists the tenant's issued credentials.
- `GET /api/v1/credentials/{id}` returns one of them.
- `POST /api/v1/credentials/verify` verifies any credential a caller supplies, statelessly.

There is no route that records an external credential, so a tenant that wants an inventory of everything it holds cannot build one from this API. Closing that gap is the **credential library**: one tenant-scoped view over both origins, each record carrying a point-in-time verification outcome, and a durable copy held for the external ones alongside the native ones the storage service already keeps.

The obvious move is to grow the two read routes: let the list return external credentials too, and give the detail route their ids. Three things make that the wrong move, and the first is the one that matters most.

First, the semantics. `/api/v1/credentials` means "the credentials you issued". The library means "everything you hold": things you issued, things others sent you, and, through the transition above, things that are not credentials at all. A route named credentials cannot honestly list a received PDF. The collection is a different noun, and stretching the old name over it misdescribes both, permanently, in the most public place a name can live: the URL every integration is written against.

Second, the shapes do not match. A library row needs fields an issued credential has never had: an origin, a source location, a point-in-time verification outcome, per-action capability flags. Growing the list means every existing caller's rows change shape underneath them.

Third, the current list route hands out decryption keys. `GET /api/v1/credentials` maps every row through `revealDecryptionKey` before returning it (`route.ts`), and the published schema documents `decryptionKey` as a field on every returned credential (`lib/swagger/schemas.ts`). For a list of credentials we issued ourselves, that is a recorded convenience. For a list that also contains credentials other parties sent us, it is a bulk key-disclosure route, and the library's design forbids keys on list rows outright. So growing the old list forces a choice between two bad outcomes: keep revealing keys on rows that must not carry them, or quietly delete a documented field from under every existing caller.

So the question is not whether to build the library. It is whether the amalgamated view is the old collection grown, or a new one.

## Decision

1. **The library is a new surface, `/api/v1/library`.**
   The library is a different resource, not a bigger version of the old one, for the semantic reason above: "everything you hold" is a different noun from "the credentials you issued", and it needs a name that can also hold what the transition will bring. "Library" is that name.
   Everything the library does lives under the new path: the list over both origins, the detail view, registering an external credential, re-verification, annotations, deletion, bulk fetch.

2. **`/api/v1/credentials` keeps two jobs: issuing and public verification.**
   `POST /api/v1/credentials` and `POST /api/v1/credentials/verify` do not change. They make and check credentials; the library holds them. One path per job.

3. **The two old read routes are retired with `410 Gone`, with no deprecation window.**
   The `GET` handlers in `credentials/route.ts` and `credentials/[id]/route.ts` are replaced by a `410` response carrying a `code` that names the retirement and points at the replacement route. Authentication still runs first, as it does on every route, so an unauthenticated call gets `401` exactly as before.
   We accept this as a breaking cut and treat it as one: #965 owns the migration guide and release notes. What the cut buys is that a stale integration fails loudly with the new route named in the response, instead of running for months against a list that quietly stopped being the whole story.

4. **The retirement and the new surface ship in the same release.**
   The work is split into separate tickets for review (#962, #964, #955 build the surface; #965 retires the old routes), and they ship together. There is no acceptable release where the old routes are gone and the library is not there, and none where both lists answer at once.

## Consequences

Positive:

- The library's list can forbid key material from day one, because no caller was ever promised keys on that path. The key-disclosure problem above never exists.
- The old surface gets simpler: two routes, two jobs, and the docs can say it in one line — `/credentials` makes and checks, `/library` holds.
- A caller still on the retired routes finds out on their next call, with the replacement named in the body.

Negative:

- Callers of the two retired read routes must move in one step. There is no overlap period. The `410` body and the migration guide are what we give them instead.
- Until the library routes exist, this ADR changes nothing on disk. The retirement handlers, the migration guide, and the new surface land through their own tickets; this record is what stops the old routes growing library features in the meantime.

## Alternatives considered

**Grow `/api/v1/credentials` into the library** (the obvious move above). Rejected. The row shape changes under every existing caller, and the key problem has no good exit: either external rows get the same key-revealing treatment as native ones, which the library forbids, or `decryptionKey` disappears from a route whose published schema promises it. Both are silent breaks. A new path makes the break loud and one-time.

**Retire the old routes behind a deprecation window.** Rejected. The window keeps the key-revealing list alive alongside the surface built to withhold keys, doubles the list surfaces we maintain and document, and ends in the same hard cut anyway. A reference implementation's integrators get a migration guide either way; the window only delays the honest moment.

**Call it `/api/v2/credentials` instead of `/api/v1/library`.** Rejected. Version two of "the credentials you issued" is the wrong name for "everything you hold, whoever issued it". The rename is the point, not a cosmetic: the resource is different, so the path should say so.

## Not decided here

- What a library record is: how native and external credentials are stored, and how verification history hangs off them. The next ADR in this set decides it, and decides it differently for the two origins.
- How the library's slow work runs (verifying an external credential can take a while, and this deployment has no workers). Its own ADR in this set.
- Who holds decryption keys for external credentials, and what happens when a credential arrives before its key. Its own ADR in this set.

## References

- Epic #950 — the library's scope and decomposition.
- #951 — the ticket that asks for these decisions to be recorded before implementation starts.
- #962, #964, #955 — the list, detail, and register tickets that build the new surface.
- #965 — the retirement ticket: the `410` behaviour, the migration guide, and the ship-together rule.
