# UNTP Playground release notes

These are the user-facing release notes for the UNTP Playground. They focus
on what's new for you, the person using the playground, not on the internal
mechanics. For a technical, per-change log see [CHANGELOG.md](./CHANGELOG.md).

## 0.4.2 - 2026-09-22

A patch for the sample Digital Product Passport that the Playground offers
for download. The sample was issued with a validity window that ended on
1 March 2026, so since then its Verification step has failed with
"Credential has expired". The sample is reissued by the same test issuer with
the same content and a validity window that ends on 1 March 2040, so it
verifies again. If you kept a copy of the old sample, download it again.

- Technical changelog: [CHANGELOG.md § 0.4.2](./CHANGELOG.md#042---2026-09-22)
- Container image: [ghcr.io/uncefact/tests-untp/untp-playground](https://github.com/uncefact/tests-untp/pkgs/container/tests-untp%2Funtp-playground) (`:0.4.2`, `:latest`)

## 0.4.1 - 2026-09-21

A patch for large Conformity Schemes on the hosted Playground. The JSON-LD
Document Expansion and Context Validation step expands the whole document on
the server, where a scheme of around 90 KB takes about 13 seconds. That left
almost nothing in hand against the 15 seconds the browser allowed, so the
step could fail with a service timeout while the expansion was still
finishing. The browser now allows 60 seconds, and the timeout message says
the service may be unavailable or still expanding a large document.

The longer wait applies to credentials as well as schemes. On a self-hosted
Playground with no proxy timeout of its own, an unanswered context check now
stays in progress for 60 seconds instead of 15, and the credential's result
stays in progress until that step settles. A refused connection or an HTTP
error still fails straight away.

On the hosted Playground, a context check that waits more than about 30
seconds for the server's response fails with HTTP 504, which the Playground
shows as a service failure. So a document that needs more than that on the
hosted instance still fails. A self-hosted Playground has no such cap unless
its own proxy adds one.

- Technical changelog: [CHANGELOG.md § 0.4.1](./CHANGELOG.md#041---2026-09-21)
- Container image: [ghcr.io/uncefact/tests-untp/untp-playground](https://github.com/uncefact/tests-untp/pkgs/container/tests-untp%2Funtp-playground) (`:0.4.1`, `:latest`)

## 0.4.0 - 2026-09-21

The 0.4.0 release gives the UNTP Playground a tabbed workspace for
credentials, Conformity Schemes and Identity Resolver link sets. It validates
each loaded family in one session, makes failure causes visible, and produces
reports that include every loaded and validated family.

- Technical changelog: [CHANGELOG.md § 0.4.0](./CHANGELOG.md#040---2026-09-21)
- Container image: [ghcr.io/uncefact/tests-untp/untp-playground](https://github.com/uncefact/tests-untp/pkgs/container/tests-untp%2Funtp-playground) (`:0.4.0`, `:latest`)

### Breaking changes

**Update JSON report consumers.** The scheme array is now `conformitySchemes`
instead of `conformitySchemeResults`. The duplicate `overallStatus` field has
been removed from every entry; use `status`. The `verifiableCredentials`,
`conformitySchemes` and `linkSets` arrays are always present, including when
one family is empty.

The HTML report heads a scheme block with the card's title instead of the type
and version. Validation outcomes can also change after upgrading: Conformity
Schemes now undergo Structural Parse, and a verification-service success is
overridden when the credential is expired, not yet valid, or has a validity
bound the Playground cannot read.

### A tabbed artefact workspace

**Three tabs.** Credentials, Conformity Schemes and Link Sets each have their
own upload and URL controls. Each tab keeps validating its loaded artefacts
in the background when another tab is selected. A tab shows its loaded
instance count and a failure marker when an instance has failed. The
Credentials tab also shows a spinner while a credential is being verified.
Empty tabs show no marker.

### Link sets as a first-class artefact

**Load from a resolver or file.** On the Link Sets tab, resolve an identity
resolver URL or upload a link set JSON file. Resolver requests include
`?linkType=all` unless the URL already supplies a `linkType` value. The card
lists credential links, secondary resolver links and a count of other links.

**Validate the selected version.** Choose the UNTP spec version before adding
the link set. The Playground validates it against that version's published
Identity Resolver linkset schema and records the selected version on the card
and in the report. The current selector offers v0.7.0.

The Link Sets tab also offers a `Test Link Set` sample.

**Check link type coverage.** The second step compares each verified
credential's detected type with its `dpp`, `dcc`, `dfr` or `dte` relation. It
shows how many relation links have been checked and lists mismatches. Coverage
can remain pending while linked credentials have not been verified.

### Verify linked credentials and secondary resolvers

**Verify credential links.** Use Verify on a listed credential link to fetch
the target and run it through the Credentials tab pipeline. The link-set row
tracks the same credential instance's verifying or verified state, and the
report records that the credential was reached through the link set.

**Follow secondary resolvers.** A secondary resolver link is listed with a
Resolve action. Selecting it loads the target link set as its own card, using
the same URL resolution flow as the Link Sets tab.

### Decrypt encrypted credentials in the browser

**Supported storage envelopes.** Credentials using the reference storage
service's AES-256-GCM envelope can be decrypted in the browser with the
matching 64-character hexadecimal key. The decrypted credential then runs
through the normal validation pipeline. The key is used in the browser only,
and is not stored, logged or sent anywhere. Unsupported encrypted formats stay
locked with an explanation. Read [Decrypting encrypted credentials](../../documentation/docs-playground/decrypting-encrypted-credentials.md)
for the supported format and the recovery path for other formats.

### Multiple schemes and credential instances

**Keep each instance.** Load and validate more than one Conformity Scheme in
the same session. Multiple credentials of one type remain separate instances
and appear under a shared type heading with a count. The HTML report titles
each block the way its card is titled.

### A structural check for Conformity Schemes

**Four checks.** Conformity Scheme validation now runs Version Detection,
Schema Validation, Structural Parse and JSON-LD Document Expansion and Context
Validation. Structural Parse checks the scheme's root `id` and `name`, plus
`id`, `name`, `version` and `status` on every profile and criterion. It lists
the fields that fail and contributes to the scheme's overall verdict.

**Independent outcomes.** A step blocked by an earlier failure is shown as
Not executed and names that step. A scheme version without a Playground parser
is labelled Scheme invalid. Schema Validation and the JSON-LD check remain
independent, so a document can report a structural failure and a context
failure separately.

### Clearer failure reasons

**Four evidence classes.** Failed schema, VCDM, extension, Conformity Scheme,
link-set schema and JSON-LD context steps now say whether the artefact could
not be fetched, was fetched but unusable, the submitted document was invalid,
or the cause is unknown. Cards and validation details show the class and
diagnostic details. The JSON report carries the structured failure object. HTML
reports include its class label and explanation, including within the
schema-step message for link sets.

### More precise UNTP version and schema checks

**Recognise the UNTP context wherever it appears.** The Playground now detects
a credential's UNTP version from a matching context URL at any position in its
`@context` array, including the second entry. Context versions at
the end of an address without a trailing slash are read correctly, core
prerelease versions are preserved, and supported published schema URLs remain
unchanged. Missing versions, unsupported types and unregistered extension
versions fail schema selection before a schema is fetched with details about
what was observed.

### Safer URL retrieval

**One bounded fetch budget.** URLs pasted into the Playground are retrieved
through the shared guarded resolver. One 10-second budget covers DNS,
redirects, transport and body reading. Each redirect is checked before it is
requested, and the connection uses the address that was checked.

**Safer failures.** By default, private and reserved address ranges and internal-looking
hostnames are refused. Public IPv6 literals are fetched, private IPv6
literals are refused, and a 304 response is not followed. Network errors are
reported with safe messages rather than raw Node error details.

### Guarded schema and context loading

**Shared loaders.** Schema requests and JSON-LD context expansion use the
shared guarded `untp-utils` loaders. Bundled copies are used when available if
a publisher's host does not deliver the artefact. Schema body reads and
browser context retrieval have a 15-second budget, while the server-side
resolver uses a 10-second budget for context retrieval.

### Credential validity windows

**Use the credential's claims.** When the verification service reports a
credential as verified, the Playground now checks `validFrom` and `validUntil`
from the credential claims. An expired or not-yet-valid credential, or one with
a present validity bound the Playground cannot read, fails the Verification
step.

### Reports for every loaded family

**Link sets and grouped credentials.** The generated report includes every
loaded link set with its validation version, Schema Validation result and Link
Type Coverage details. Credentials are grouped by type in HTML, while the
JSON report carries the three family arrays, titles and link-set provenance
for credentials verified from a link set. A link set can be reported before
every linked credential has been checked, so coverage records the work done
at generation time.

Encrypted credentials stay off the report until they are decrypted and
validated.

**Fresh report state.** Adding, replacing or removing an artefact, verifying a
linked credential or changing a URL binding discards the generated report.

### New environment variables

For local development only, the off-by-default `FETCH_ALLOW_PRIVATE_URLS=true` setting lets any browser user make `/api/fetch` retrieve HTTP or HTTPS documents from private, loopback and other reserved destinations, including cloud metadata addresses, directly or through redirects.

**Configurable documentation links.** Set
`NEXT_PUBLIC_DECRYPTION_DOCS_URL` to change the encryption support link on
locked credential cards. Set `NEXT_PUBLIC_LINK_SET_VALIDATION_DOCS_URL` to
change the link-set validation documentation link on link set cards. Set
`NEXT_PUBLIC_CREDENTIAL_LINKS_DOCS_URL` to change the link explaining how
credential links are identified in a link set. All three default to the
corresponding Playground documentation pages in the repository.

## 0.3.0 — 2026-05-15

This release brings the playground up to
[UNTP version 0.7](https://untp.unece.org/docs/specification/) and adds
support for validating ConformityScheme artefacts as defined in the
[Conformity Vocabulary Catalog specification](https://untp.unece.org/docs/specification/ConformityVocabularyCatalog).

- Technical changelog: [CHANGELOG.md § 0.3.0](./CHANGELOG.md#030---2026-05-15)
- Container image: [ghcr.io/uncefact/tests-untp/untp-playground](https://github.com/uncefact/tests-untp/pkgs/container/tests-untp%2Funtp-playground) (`:0.3.0`, `:latest`)

### Test ConformityScheme documents, not just credentials

You can now drop a ConformityScheme JSON-LD document into the playground
and have it validated end to end against the
[Conformity Vocabulary Catalog spec](https://untp.unece.org/docs/specification/ConformityVocabularyCatalog).
The scheme appears in its own section next to your credentials, and you
get the same three-step verdict you're used to: version detection,
schema validation, and JSON-LD context expansion. If a step fails, the
playground tells you exactly which one and why, so you can fix the
scheme without guessing.

### Paste a URL instead of downloading first

Both credentials and conformity schemes now accept a URL. The playground
fetches the document on your behalf, with safety rails on the server side
(only HTTPS, no internal addresses, 10 MB cap, 10 second timeout), and
then runs the same validation it would for a file. If the URL doesn't
work, the error appears inline under the input rather than as a toast
that disappears, and the URL stays put so you can correct and retry.

### A conformance report that's worth handing to someone

The downloadable report has been redesigned from the ground up. It's now
a single-column editorial document with clear status pills, source URLs
on every result, and a quieter, more legible error block. Conformity
schemes are reported alongside credentials in the same document, and the
JSON output uses self-describing field names (`verifiableCredentials`
and `conformitySchemeResults`) so downstream tools don't need to guess
which array is which. Reports look right both on screen and printed to
PDF.

### See what your test files came from

When you expand a credential or scheme card, the source filename or URL
now appears underneath the steps. The same provenance flows into the
report, so a reviewer can trace any result back to the exact artefact
that produced it.

### Sample artefacts, one click away

The right column has a new "Download test files" section with two
buttons: one for a sample Digital Product Passport and one for a sample
ConformityScheme. Use them to kick the tyres of the pipeline without
hunting around for a credential.

### Extension-friendly branding

If your organisation runs its own instance of the playground for an
extension or a specialised pilot, you can now control the visible
identity through environment variables. The report title, the "Generated
by ... Playground" footer link, the test-runner link, and the playground
version chip in the header are all configurable; nothing is hardcoded
to UNTP. The defaults still read UNTP, so existing deployments are
unaffected.

### Better explanations when things go wrong

If a schema fetch times out or returns something unexpected, the report
no longer hangs. You get a friendly message describing what happened
("The schema service did not respond in time. Please try again.") plus a
link to file an issue if it keeps happening. The same friendlier error
copy applies to JSON-LD expansion failures.

### Smaller things that add up

- The credential cards no longer show the proof-type pill. The
  information is still visible inside the expanded steps.
- Schemes that pass all validation steps get a confetti burst, just like
  credentials do.
- Inline error states now stay visible until you act on them, never
  auto-dismissing as a toast.
- The conformance report displays the date in plain `D MMMM YYYY`
  format, rather than an ISO timestamp.
