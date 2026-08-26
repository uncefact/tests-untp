---
sidebar_position: 2
title: Identifying UNTP credential links
---

# How the Playground identifies UNTP credential links in a link set

A resolved link set usually carries more than credentials. A real resolver's answer for a product identifier can include product information pages, retailer lists, and other resources alongside any UNTP credentials. The Playground lists the credential links on the link set card and reports how many other links it found without listing them, because the Playground's job is validating credentials.

## The rule

A link counts as a UNTP credential link when either of these holds:

- **Its link relation type names a UNTP credential**: `dpp` (digital product passport), `dcc` (digital conformity credential), or `dfr` (digital facility record), which the specification registers as link relation types, or `dte`, the relation the specification uses for digital traceability events. The relation can appear as the bare name, as a CURIE (`untp:dpp`), or URI-qualified (a custom RFC 9264 relation whose URI ends in the name).
- **Its target declares a verifiable-credential media type**: `application/vc+jwt` or `application/vc+ld+json`.

Both signals come from the [UNTP Identity Resolver specification](https://untp.unece.org/docs/specification/IdentityResolver), which registers those relation types and names those media types for credential targets.

One exception: resolvers often list a credential's human viewing page beside the credential document, under the same relation, with a `text/html` target type. A `text/html` target is a page about the credential rather than the credential itself, so it is counted with the other links even when its relation names a credential.

## Hints, not guarantees

The specification is explicit that the link relation and media type indicate the intended content, not a guarantee of it. The Playground follows the same rule: identification decides what is listed as a credential link, and the actual content is validated when the credential is fetched and run through the validation pipeline.

## Encrypted targets

A credential link carries an Encrypted tag when its target declares a non-empty `encryptionMethod` other than `none`, the Secure Targets attribute the specification registers for an encrypted target. An `accessRole` on its own is authorisation, not encryption, so it does not mark the target. Like the relation and media-type signals, this is a hint rather than a guarantee. Verify still fetches a tagged target, and a body that turns out to be an encrypted envelope is accepted as a locked instance on the Credentials tab, where entering its decryption key decrypts it in the browser. The check also works the other way: when a link carries no encryption metadata but Verify fetches an encrypted envelope, the row gains the Encrypted tag from that discovery.

## Secondary resolvers

A link whose relation is `idr` (bare, CURIE or URI-qualified, like the credential relations) and whose target declares the `application/linkset+json` media type points at a secondary identity resolver, the delegation the specification's Secondary Resolvers section describes: a coarse-grained scheme handing off to the resolver that holds finer-grained links. The card lists these under their own heading with a Resolve action that loads the target as a new link set card, exactly as pasting the URL into the resolve input would. They are not part of the other-links count. An `idr` link without the link set media type stays an other link.

## Everything else

Links that match neither signal (a `pip` product information page, a retailer list) are counted on the card as other links. They are not errors; they are resources outside what the Playground validates. A self-referential entry (RFC 9264 allows an empty `href` meaning the link set document itself) points at nothing outside the link set, so it is neither listed nor counted, whatever its relation, `idr` included.
