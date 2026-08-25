# ADR-049: URL bindings answer which instance a URL produced

- **Date:** 2026-08-24
- **Status:** accepted

## Context

Verifying a credential linked from a resolved link set (#812) needs each link row to report the state of "its" credential on the Credentials tab. The rows only know a URL, but [ADR-041](./041-playground-shared-per-instance-artefact-model.md) identifies credential instances by content hash, and that identity cannot answer URL questions: when one URL's content drifts between fetches, the collection appends a second instance rather than replacing the first, and when two URLs serve identical bytes, the collection replaces in place and overwrites the stored source with the later URL. A row that matches instances by their stored source therefore reports the stale first instance after drift, and loses its instance entirely after a mirror fetch.

## Decision

1. **The page keeps a URL-to-instance binding registry, written by credential ingestion itself.** Every accepted ingestion with a URL source records its URLs against the produced instance id (`recordUrlBinding` in `src/lib/urlBindings.ts`), from both entry points (the uploader's Fetch and a link set row's Verify). Because the write happens inside `handleCredentialUpload`, a binding always names the instance the latest ingestion of that URL produced; recency is causal, never inferred from array order, which replace-in-place makes meaningless as an age signal.
2. **Rows resolve exclusively through the registry, failing open.** A URL with no binding, or whose bound instance has been removed, reads as unbound and offers Verify; a stale binding never points a settled note at nothing (`resolveBoundInstance`).
3. **Both URL forms of one ingestion are bound.** The uploader stores the post-redirect `url` and now also the `requestedUrl`; both are registered, so a link row finds the instance whichever form it holds. Neither identity changes: the instance's identity stays the content hash per ADR-041, and the registry is a view over it, not a second identity.
4. **The registry is session state, held in a Map keyed by untrusted hrefs.** Resolver documents supply the keys, so a plain object would expose prototype names; the collection it mirrors is itself in-memory, so the registry does not outlive it.

## Consequences

- Link rows follow the credential a URL most recently produced, through content drift, mirror replacement, and re-fetch from either tab.
- A removed instance silently unbinds its URLs, returning rows to their Verify action.
- Features that need "what did this URL produce" (encrypted-credential handling in #813, future re-verify affordances) read the registry instead of re-deriving from sources.
- Two rows for the same URL in different link sets intentionally share state: the same URL is the same credential.

## Alternatives Considered

- **Matching rows against instances' stored source URLs.** Rejected: the stored source is rewritten on replace-in-place and multiplied on drift, so source matching reports stale or vanished state in exactly the cases that matter (the defect this ADR exists to fix).
- **Keying credential identity by URL instead of content hash.** Rejected: ADR-041 chose content-hash identity deliberately (document ids and locations are unreliable), and [ADR-046](./046-link-set-identity-is-the-resolver-request-url.md) records the URL-identity exception as link-set-specific. A URL identity for credentials would merge distinct documents served from one URL.
- **A component-local binding map inside the link set surface.** Rejected: it cannot see Credentials-tab ingestions of the same URL, so it pins rows to stale instances after a drift fetch from the other tab, and it dies with the component.

## References

- #812 (the verify-linked-credentials ticket this serves)
- [ADR-041](./041-playground-shared-per-instance-artefact-model.md) (content-hash identity the registry complements)
- [ADR-046](./046-link-set-identity-is-the-resolver-request-url.md) (the link-set URL-identity exception)
