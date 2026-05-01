# ADR: Local subclass shim around vckit-renderer for UNTP IRI expansion and browser digest verification

## Status

proposed

## Context

The reference implementation renders verifiable credentials in the browser via `@uncefact/vckit-renderer` (`Renderer` + `RenderTemplate2024`). UNTP v0.7.0 credentials embed a `renderMethod` block referencing a remote HTML template plus a `digestMultibase` integrity hash, and the renderer is responsible for fetching the template, verifying the hash, and producing the final HTML.

Two upstream limitations break this flow when the credential context is the published UNTP vocabulary (`https://vocabulary.uncefact.org/untp/0.7.0/context/`):

1. **JSON-LD IRI expansion mismatch.** `RenderTemplate2024.extractData` reads template/url/mediaType/mediaQuery from the W3C `https://w3id.org/vc/render-method#` namespace only. UNTP contexts (and the W3C v2 credentials context for `mediaType`) expand the same fields to different IRIs (`https://vocabulary.uncefact.org/untp/template`, `https://schema.org/encodingFormat`, etc.), so the renderer reports `Error: No template or url provided` even when the credential is well-formed.

2. **No browser-native digest function.** When `digestMultibase` is present, the renderer hashes the fetched template via `context.agent.computeHash(...)`, a VCKit agent pattern. The reference implementation runs the renderer standalone in the browser without a VCKit agent in scope, so verification fails with `Error: No hash function provided to verify the template`.

We maintain `vckit-renderer` ourselves and could fix both issues at the source, but we have deliberately deferred upstream changes so the work does not block the UNTP v0.7.0 release. There is also genuine uncertainty about whether `RenderTemplate2024` survives into UNTP v1 in its current form, which makes investing in upstream refactors of this code path hard to justify right now. The RI still needs to render v0.7.0 credentials end-to-end today, so the fix lands in the consumer for this release.

## Decision

We added a local `LenientRenderTemplate2024` class in `packages/reference-implementation/src/components/CredentialRender/CredentialRender.tsx` that subclasses upstream `RenderTemplate2024` and:

1. **Overrides `extractData`** to call `super.extractData` first, then for each missing field walk a small list of known IRI aliases (W3C namespaces, the legacy `2018/credentials#renderMethod#…` form, and the UNTP namespace), pulling the first match. `mediaType` defaults to `text/html` if no IRI yields a value.

2. **Overrides `renderCredential`** to inject `context.agent.computeHash = computeDigestMultibase`, a Web Crypto + multihash + base58btc utility added in `src/utils/helpers.ts`. The utility hardcodes sha2-256 + base58btc to match the encoding the renderer compares against (it does naive string equality rather than decoding multibase/multihash, so encoding must agree on both sides).

3. **Is registered against multiple provider keys** in the `Renderer` providers map: the standard `RenderTemplate2024`, the path-based UNTP IRI used by older test contexts (`https://test.uncefact.org/vocabulary/untp/core/0/RenderTemplate2024`), and the published UNTP vocabulary IRI (`https://vocabulary.uncefact.org/untp/RenderTemplate2024`). UNTP contexts expand the type to a path-based IRI rather than a fragment, so the renderer's type-extraction returns the full IRI as the provider key.

The shim and both helper utilities are documented inline with TODO comments pointing at the upstream fix that would let us delete the shim entirely.

## Consequences

**Easier:**
- v0.7.0 credentials referencing UNTP-context render methods render correctly without modifying the published context or coordinating an upstream release.
- The whole workaround is contained in one component file plus one helper module, easy to find and easy to delete when upstream catches up.
- No `node_modules` patching (patch-package), no fork, no diverging version of `@uncefact/vckit-renderer` to maintain.

**Harder:**
- New IRI aliases (future UNTP context revisions, other namespaces) require editing the alias arrays in `CredentialRender.tsx`. There is no central registry.
- The hash helper hardcodes sha2-256 + base58btc. Credentials that legitimately use a different multihash code or multibase encoding will fail verification until the helper is generalised. This is a known limitation tied to upstream's naive string compare.
- Two layers of maintenance: when upstream is fixed, both the IRI alias logic and the hash injection need to be removed together.

## Alternatives Considered

- **Patch `node_modules/@uncefact/vckit-renderer` via `patch-package`.** Rejected: hooks block edits inside `node_modules`, the patch would silently break on every minor version bump of the dependency, and patches inside the tarball are easy to miss in code review. A subclass that lives in our source tree is easier to discover and reason about.

- **Mutate the credential's `renderMethod` block at the RI to use the W3C IRIs the renderer expects.** Rejected: the credential is signed. Rewriting fields invalidates the signature, and the consumer should not be reshaping signed payloads to suit a renderer's quirks.

- **Modify the published UNTP context to map the render-method terms to W3C IRIs.** Out of scope: supporting the published `https://vocabulary.uncefact.org/untp/0.7.0/context/` as-is is a hard requirement. The published context is what implementers consume, and rewriting it to suit the renderer would invalidate every credential already issued against it.

- **Fix the IRI handling and Web Crypto fallback in `vckit-renderer` itself.** We own the package and could land the change directly. Deferred for two reasons: shipping the upstream fix on the v0.7.0 timeline risked blocking the release, and `RenderTemplate2024` may not survive into UNTP v1, so investing in a refactor of code that may be removed is hard to justify. The shim buys us the option to revisit this when the v1 direction is clearer.

## References

- `packages/reference-implementation/src/components/CredentialRender/CredentialRender.tsx`. The `LenientRenderTemplate2024` class and provider map.
- `packages/reference-implementation/src/utils/helpers.ts`. `computeDigestMultibase` and `base58Encode`, with TODO pointing at the upstream naive string-compare behaviour.
- `@uncefact/vckit-renderer` `1.0.0-next.61`. Current pinned version that exposes the limitations addressed here.
- UNTP v0.7.0 context: <https://vocabulary.uncefact.org/untp/0.7.0/context/>
