---
sidebar_position: 5
title: Generating reports
---

# Generating a conformance report

A report records every reportable artefact loaded in the Playground (credentials still locked by encryption are left out) and the result of each check that ran on it. It is generated on demand from what is on screen, and downloaded as HTML or JSON.

## When Generate Report is available

The Generate Report button is enabled once at least one reportable credential, conformity scheme or link set is loaded (a locked credential alone does not count), every credential and scheme has settled, and every link set's `Schema Validation` step has settled:

- Every credential and every conformity scheme must have a settled result. A card still verifying holds the button.
- A link set must have a settled `Schema Validation` step. Its `Link Type Coverage` step counts how many linked credentials you have verified so far, so it can still be pending; that does not hold the button.
- Encrypted credentials that have not been decrypted are not part of the report and do not hold the button.

A link set on its own is enough to generate a report.

A generated report describes the screen at the moment it was made. Adding, replacing or removing an artefact, verifying or re-verifying a linked credential, or decrypting a credential discards it, and Download Report is disabled until you generate again.

## What the report contains

Three sections, each shown only when its family has at least one entry, with an instance count in the heading:

- **Verifiable Credentials**, grouped by credential type in the order of the Credentials tab (`Digital Product Passport`, `Digital Conformity Credential`, and so on), each group headed by the type name and its instance count. Each block is titled the way its card is: the filename, or the final path segment of the URL it was fetched from, else the credential type; never the raw URL. A credential decrypted in the browser lists `Decryption` as its first step; an unencrypted credential has no such step.
- **Conformity Schemes**, one block per scheme, titled by the scheme's own `name`, else the final path segment of its URL, else its filename, else `Conformity Scheme`.
- **Identity Resolver Link Sets**, one block per link set, subtitled `Link Set` and the UNTP spec version it was validated against, with `Schema Validation` then `Link Type Coverage`. A failed `Schema Validation` lists each offending path and the rule it broke, or explains that the schema could not be loaded or used. `Link Type Coverage` shows `n of m credential links checked`, or says there are no UNTP-relation credential links to check when the link set lists none. It lists each mismatch as `<relation> link resolved to <detected type>` with the link's `href`. A pending coverage step means some linked credentials were not verified when the report was generated; it does not fail the link set. A mismatch does.

The report passes when every entry passes.

## The JSON report

The JSON download carries the same content as the HTML without the grouping, which is a reading aid. Its top-level fields:

| Field                   | Contents                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifiableCredentials` | One entry per credential instance, in upload order. Each has `title`, `status`, `core` (type, version, steps), `source` when the origin is known (for a credential verified from a link set, `source.via` is `link-set` and `source.linkSet` names that link set by its resolver URL or filename), and `extension` when one was detected.                                                                                                                                                                                                                                                                             |
| `conformitySchemes`     | One entry per scheme instance, in upload order. Each has `title`, `status`, `type`, `version`, `steps`, the `conformityScheme` document, `source` when the origin is known, and `name` and `id` when the document carries them. `title` is what the HTML shows; `name` is the document's own field, present only when it has one.                                                                                                                                                                                                                                                                                     |
| `linkSets`              | One entry per link set, in upload order. Each has `title`, `status`, `validationVersion`, `source` when the origin is known, the `linkSet` document and exactly two `steps`: the schema step with its recorded attempt (always `kind`, `version` and `schemaUrl`, then the validation `errors` when the schema ran, a `reason` and a `message` when it could not be loaded, or a `message` alone when it loaded but could not be used) and the coverage step with `total`, `checked`, `mismatches`, and a `note` when there was nothing to check. The coverage step is the only step whose `status` can be `pending`. |
| `pass`                  | `true` when every entry in every family passes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

All three family arrays are always present, empty when nothing of that family was loaded.

The scheme array was called `conformitySchemeResults` in Playground 0.3.0, and every entry carried a duplicate `overallStatus` beside `status`; both are gone. Tools reading them need updating.
