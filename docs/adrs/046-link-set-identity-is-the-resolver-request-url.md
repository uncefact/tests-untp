# ADR-046: Link set identity is the normalised resolver request URL

- **Date:** 2026-08-20
- **Status:** accepted

## Context

The Link Sets family (#811) is the third family on the Playground's shared per-instance model. That model's identity rule, recorded in [ADR-041](./041-playground-shared-per-instance-artefact-model.md), is that an instance is identified by the content hash of its document, and #811's acceptance contract forces the question of whether that rule fits link sets: it requires that re-resolving the same identifier replaces the existing card in place, explicitly including the case where the resolver's response body has changed since the last resolve.

A link set is not a document a user authors; it is a resolver's answer for an identifier at a moment in time. The same identifier can legitimately return different bodies minutes apart (links added, titles translated, ordering changed). Under content-hash identity every such change would append a new card beside the stale one, so a user refreshing an identifier would accumulate near-duplicates instead of seeing the current answer, which is the opposite of what #811's replace-in-place criterion asks for.

A second property of resolvers matters: the URL a response finally comes from is not stable. A resolver may answer a resolve request with a redirect to a per-request URL (a signed token, a session-scoped path on a CDN), so the post-redirect URL can differ on every resolve of the same identifier.

## Decision

1. **A link set instance is identified by the normalised request URL, else the uploaded filename.** The normalised request URL is the URL the user asked to resolve after `?linkType=all` normalisation (`normaliseResolverUrl` in `src/lib/resolveLinkSet.ts`), before any redirect. It is the user's notion of "the same identifier", so re-resolving it replaces the card in place even when the response body changed, which is what #811's contract requires and what content-hash identity cannot provide for a response that legitimately varies over time. File uploads have no request URL, so the filename identifies them, matching how a user distinguishes the files they drop.
2. **The post-redirect URL never keys the instance.** The proxy's `finalUrl` (redirects followed) is returned by the resolve helper but not used as identity, because a resolver that redirects to a per-request URL would otherwise defeat replace-in-place on every re-resolve.
3. **The shared model's identity mechanics are reused, not changed.** ADR-041's `contentHash` slot is a generic identity key; the link set family passes its URL/filename key through the same slot and reuses `matchTarget`/`upsert`/`remove` untouched. (The model does gain a `restore` operation with #811, for the removal decision recorded in [ADR-047](./047-link-set-removal-is-undoable-not-confirmed.md), not for identity.) Credentials and schemes keep content-hash identity: their documents are stable artefacts a user uploads, where identical content genuinely is the same instance.
4. **The request URL is also what the user sees.** The card title, the source caption, and the replace toast all derive from the normalised request URL, because #811's contract words them in terms of the URL the user asked to resolve. The post-redirect URL is not shown this phase; if redirect provenance is wanted later it is displayed as an addition, never as the card's identity or title.

## Consequences

- Refreshing an identifier converges to one card showing the current answer, at the cost that two genuinely different snapshots of the same identifier cannot be held side by side. Holding snapshots side by side has no use in the validation flows the Playground serves.
- Two different identifiers that redirect to the same link set document remain two cards, which matches the user's mental model (they resolved two identifiers) even though the content is one document.
- The identity rule is now per-family rather than one rule for all three families, so a fourth family must choose its key deliberately rather than inheriting content hashing by default.

## Alternatives Considered

- **Content hash, as ADR-041 records for the other families.** Rejected for link sets. A changed response body would append beside the stale card instead of replacing it, violating #811's replace-in-place criterion and accumulating near-duplicates for a value that is expected to change over time.
- **The post-redirect final URL.** Rejected. Resolvers that redirect to per-request URLs (signed or session-scoped targets) would give the same identifier a different key on every resolve, so replace-in-place would silently never fire; a review of the working diff caught exactly this defect before merge.
- **The link set's first `anchor`.** Rejected. The anchor is optional in RFC 9264 contexts, a response can carry several, and a malformed response could omit or duplicate them; the request URL is always present and always singular for a resolve.

## References

- #811 (acceptance contract requiring replace-in-place for a re-resolved identifier)
- [ADR-041](./041-playground-shared-per-instance-artefact-model.md) (the shared model this scopes an exception to)
- [RFC 9264](https://www.rfc-editor.org/rfc/rfc9264) (link set document format)
