---
sidebar_position: 3
title: Validating link sets
---

# How the Playground validates a link set

A link set added on the Link Sets tab, whether resolved from an identity resolver or uploaded as a file, runs two steps: `Schema Validation`, which checks the document's shape, and `Link Type Coverage`, which checks that each credential reached through a UNTP relation is the kind of credential the relation claims. The first is described here, the second under [Link type coverage](#link-type-coverage).

`Schema Validation` checks the document against the UNTP Identity Resolver linkset JSON Schema and settles to success or failure. The card's subtitle names the version it was checked against, so the record of what was checked stays with the card rather than following the selector.

## Which schema and version

The schema is published per UNTP spec version at `https://untp.unece.org/artefacts/schema/v<version>/idr/LinksetSchema.json`. The Playground fetches it through the same guarded route as credential and scheme schemas and caches it for the session. When the publishing host does not deliver the schema (it cannot be reached, answers with an error status, or returns something that is not JSON), the Playground serves its bundled copy of the same schema when it has one, so the check usually still runs. A `Schema Validation` failure that says the schema could not be loaded means the Playground did not obtain a usable schema for that validation attempt.

A link set carries no version marker of its own, so you choose the version. The selector under the "Add a link set" heading defaults to the latest version that publishes a linkset schema (v0.7.0 is the only one today). It applies to link sets you add next. To check a link set that is already loaded against another version, change the selector and resolve or upload it again. Credentials and conformity schemes are unaffected: they keep the versions detected from their own contexts.

## What the schema checks

The published schema requires:

- a top-level object whose only member is a `linkset` array, where each entry is a link context object with an `anchor`;
- link relations as members of the link context object, each an array of link target objects;
- `href` and `title` on every link target;
- only the properties the schema declares on a link context object and on a link target. Anything else fails as an unknown field.

A failed step lists each offending location and the rule it broke, for example a missing `title` under a relation's first target, or an unknown property on a target.

### The relation-name rule

The published schema (v0.7.0 as of this page) admits a link relation only when its name is either a lowercase name of letters and hyphens, or an `http://` or `https://` URL whose remaining characters, after the scheme, are only letters, digits, dots and slashes. Everything else is rejected as an unknown field on the link context. In practice this rejects:

- CURIEs such as `untp:dpp`, and short names containing digits such as `dpp1`;
- URL relations containing a hyphen, a port, a fragment or a query, such as `https://my-resolver.example.org/voc/dpp`;
- short names that start with `anchor`, `description` or `itemDescription`, because the schema excludes those prefixes rather than the exact reserved names.

This is a restriction of the published schema, not something the Playground adds. The card names the rejected relation and where it sits. The error concerns the relation name only, so any credential links listed on the card can still be verified. The `anchor` and `href` values follow a looser pattern and are not subject to this rule.

The Playground identifies credential links from bare names, CURIEs and URI-qualified forms (see [Identifying UNTP credential links](./identifying-untp-credential-links.md)). Identification decides what is listed as a credential link. It does not establish that the relation name passes the selected schema.

## When the schema cannot be loaded

If the schema service does not answer in time or cannot be reached, `Schema Validation` fails with a message saying the schema could not be loaded and the document was not assessed. Resolve or upload the link set again to retry. If the service answers with an error or a body that is not a schema, the message names what was reported and asks you to report it to the Playground operator with the schema URL if it keeps happening. If the schema loads but cannot be used, the message says so and asks you to report it, because a retry gives the same answer. The card stays removable in every case.

## What the schema step does not check

Schema validation is about the shape of the document. It does not check:

- whether a relation name is a recognised UNTP relation (`dpp`, `dcc`, `dfr`, `dte`);
- whether the document a link points at is a valid credential. Verifying a linked credential runs it through the Credentials tab pipeline.

Whether a linked document is the kind of credential its relation claims is the second step's job, described next.

## Link type coverage

The UNTP Identity Resolver specification says a link relation states the intended content of its target, and that the actual content can only be confirmed by fetching it. The `Link Type Coverage` step does that confirmation. For every link the card lists as a credential link under a `dpp`, `dcc`, `dfr` or `dte` relation, once that credential has been fetched by URL (from the card's Verify action, or by pasting the same URL on the Credentials tab), the credential type the Credentials tab detected is compared with the relation it was linked under. A `dcc` link that resolves to a Digital Product Passport is a mismatch. So is a credential whose type the Playground does not recognise, and a recognised type no relation names, such as a Digital Identity Anchor: an uncomparable type counts as a mismatch rather than leaving the link unchecked. A recognised extension is compared on the core type it extends, so a Digital Livestock Passport matches a `dpp` link while the mismatch line, when one is shown, names the extension.

The step shows how many of the link set's relation links have been checked, for example `1 of 3 credential links checked`. It fails as soon as any link mismatches, listing each mismatch as `<relation> link resolved to <detected type>` with the link's `href`, and each checked row says whether its type matched, beside its verified state. It succeeds when every relation link has been verified and matches. While links remain unverified it stays pending; a pending coverage step does not put the card into a verifying state, does not block removing the card, and does not change the card's overall status. Only a mismatch does.

What the step does not do:

- A link listed as a credential link only because its target declares a verifiable-credential media type, with no UNTP relation, is not counted. There is no claimed type to compare against.
- The comparison is about type, not validity. A credential can match its relation and still fail its own validation on the Credentials tab, and the row will say both.
- An encrypted credential that has not been decrypted yet has no type to compare, so its link stays unchecked until it is decrypted.
- A link set with no UNTP-relation credential links has nothing to check; the step succeeds and says so.
- A fetch of a linked URL that returns nothing acceptable (the fetch fails, or the document is refused), whether from the card's Verify or from the Credentials tab's URL input, forgets the earlier result for that URL: the row goes back to Verify and the link counts as unchecked again. The credential card that was loaded earlier stays on the Credentials tab. If the same URL was fetched again successfully while the failing attempt was still in flight, that newer result is kept.
