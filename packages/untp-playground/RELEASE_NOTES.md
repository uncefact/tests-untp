# UNTP Playground release notes

These are the user-facing release notes for the UNTP Playground. They focus
on what's new for you, the person using the playground, not on the internal
mechanics. For a technical, per-change log see [CHANGELOG.md](./CHANGELOG.md).

## Unreleased

### Safer URL retrieval

URLs you paste into the Playground are now retrieved through a shared,
hardened fetch path. One 10-second budget covers looking up the address,
following redirects and reading the document, where each redirect hop
previously got a fresh timer of its own. Each redirect is checked before it is
requested, and the connection uses the address that was checked, so a URL
cannot be switched to an internal host part-way through.

The range of addresses and hostnames the Playground refuses is wider:
internal-looking suffixes such as `.internal` and `.local`, carrier-grade and
other reserved address space, and further non-public ranges. Error messages no
longer show the address a hostname resolved to. A URL that names a bare IPv6
address now works when that address is public, and is refused with a clear
message when it is not. Before, every such URL failed as a lookup error.

Two cases are now refused outright. A `304 Not Modified` is reported as a
failure instead of being followed as a redirect, and a hostname whose lookup
returns no address is reported as a failure instead of being tried. Messages
for connection failures are now fixed, safe text rather than the underlying
network error. If a site labels its response with an unusual content type, the
Playground may tell you the address did not return valid JSON instead of
pointing out that it is a web page.

### More precise UNTP version and schema checks

The Playground now recognises a UNTP context wherever it appears in a credential's `@context`, so a credential that carries its UNTP context somewhere other than the second entry is recognised instead of being reported as an unsupported version, and its schema is checked. A context whose version is the last part of the address with no trailing slash, such as one ending `/dpp/0.5.0`, is read as its version, and schema validation then reports the exact context string the published schema requires. A complete prerelease version such as `0.7.0-rc.1` is preserved for the core credential, while a Digital Livestock Passport version read from a context filename keeps only the first part of a dotted prerelease, so `0.4.1-beta1.2` is read as `0.4.1-beta1` and is recognised only when that shorter version is one the Playground knows. Published schema addresses are unchanged for supported credential types and versions, and Digital Livestock Passport extension contexts continue to work. A missing version and an unsupported credential type are reported before any schema is fetched, with advice to check the type and `@context`, and no retry is offered; a Digital Livestock Passport whose version the Playground does not know is reported the same way, as an unsupported extension version. A Conformity Scheme older than UNTP 0.7.0 is reported as having no published schema layout, and the validation advice tells you to use a Conformity Scheme published for UNTP 0.7.0. Cards and reports keep their existing labels where no version can be detected.

### A structural check for Conformity Schemes

A Conformity Scheme now goes through four checks instead of three: Version Detection, Schema Validation, the new Structural Parse, and JSON-LD Document Expansion and Context Validation. The new check reads the document the way the rest of the toolchain does, so a scheme the published JSON Schema accepts but the parser cannot read is now reported on the card rather than only failing later.

Structural Parse checks the scheme's own `id` and `name`, and the `id`, `name`, `version` and `status` of every profile and criterion. Each failure names the field it is about, so a blank required value is caught even where the published schema allows an empty string. A failure here changes the scheme's overall verdict. Reading the document for this check never alters the document you uploaded or where it came from.

A step an earlier failure prevented from running is still shown as a failure, labelled `Not executed` and naming the blocking step. A scheme whose declared version has no parser in the Playground is a fault in the scheme and is labelled `Scheme invalid`. A scheme published before UNTP 0.7.0 keeps its schema-selection diagnosis, while its context check still runs independently. The structural check records that schema selection prevented it from running. When version detection fails, the three later checks all report that they were skipped. Schema Validation and the JSON-LD check still run independently of each other, so a scheme with a blank `id` is reported by both the structural check and the JSON-LD check.

Scheme step details now open in the same details view as credential step details. That view lists every error in a group rather than only the first, and its heading counts errors rather than groups, for credentials and link sets as well as schemes.

A Conformity Scheme whose `name` is blank or only spaces is now titled by the final part of its URL, else its filename, rather than by an empty heading.

### Link sets in your report

A generated report now includes every link set you loaded, with the UNTP version it was checked against, the schema result, and how many of its credential links you verified and whether each was the kind of credential its link claimed. You can generate a report from a link set alone, and you do not have to verify every link first: the coverage line records what you checked.

### Credentials grouped by type

The HTML report lists credentials under a heading per type, with a count, and titles each block the way its card is titled: a credential by its filename or the last part of its URL, a scheme by its name, a link set by the resolver address.

### One JSON field renamed

The JSON report's scheme array is now `conformitySchemes` (it was `conformitySchemeResults`), and the `linkSets` array joins it. All three family arrays are always present, and every entry now carries one `status` field (the duplicate `overallStatus` is gone). If a tool of yours reads the old names, update it.

### Clearer failure reasons in validation steps

Failed schema, VCDM, extension, conformity scheme, link-set schema and JSON-LD context steps now say what happened: the artefact could not be fetched, the artefact was fetched but is unusable, the submitted document failed against a usable artefact, or the cause could not be determined. The card, View Details and the downloadable report carry the same class and diagnostic details. The one exception is a link set's schema step, whose class appears on the card, in View Details and in the JSON report, while the HTML report shows its message alone. A pop-up message now appears only when something unexpected breaks. A fetch failure, an unusable artefact or a document fault is shown on the step itself instead.

The JSON report records the additive `failure` object on failed steps, including the class, diagnostic code, message, remediation, artefact URL and service or upstream status when available. The field is optional, so anything already reading earlier reports is unaffected. Schema body reads include a 15-second browser timeout, and an unexpected pipeline error settles the remaining steps instead of leaving the run in progress.

A credential whose `@context` carries no version the Playground recognises, or whose `type` is not a UNTP type it validates, or whose extension version is not registered, is now reported as a fault in the submitted document. The message names the values it saw and the versions or types it matched them against. When the Playground cannot determine a cause it says so and still shows the diagnostic code, the artefact URL and any status it observed, so the details can be passed on.

The VCDM Version Detection step now records a failure class and offers View Details when the declared VCDM version cannot be mapped. If an upstream host returns HTTP 403, 404 or 410 for a schema or declared context URL and no bundled copy exists, the artefact is reported as not published for the declared version. Other 4xx responses, including 408 and 429, remain fetch failures with retry-or-report remediation. A third-party context URL is named as its own missing `@context` entry without a UNTP version claim. A missing dependency imported by a declared context remains a fetch failure and names the dependency. When the document declares a single context URL and the declaration walk completes, the report also names the declaring context. Otherwise, including when the document is too large for the Playground to trace fully, it names only the dependency and status without asserting which context imported it. The report directs the dependency's publisher to publish it. Link-set schema fetches are excluded: a 4xx remains a fetch failure and advises picking a UNTP version with a published link-set schema. HTTP 5xx responses, network failures and timeouts remain fetch failures, and an available bundled copy is still used.

When a publisher's host fails, validation continues against a bundled copy of the published artefact where one exists, so a host outage does not stop the check. Context retrieval has two budgets on both the credential and Conformity Scheme pipelines: the server-side resolver gives up after 10 seconds, while the browser allows up to 15 seconds across the request and response body. A context that has no bundled fallback and exceeds either budget ends as a fetch failure. Schemas written as `true` or `false`, which JSON Schema allows, are accepted wherever a schema is loaded.

## 0.3.0 — 2026-05-15

This release brings the playground up to
[UNTP version 0.7](https://untp.unece.org/docs/specification/) and adds
support for validating ConformityScheme artefacts as defined in the
[Conformity Vocabulary Catalog specification](https://untp.unece.org/docs/specification/ConformityVocabularyCatalog).

- Technical changelog: [CHANGELOG.md § 0.3.0](./CHANGELOG.md#030---2026-05-15)
- Container image: [ghcr.io/uncefact/tests-untp/untp-playground](https://github.com/uncefact/tests-untp/pkgs/container/tests-untp%2Funtp-playground) (`:0.3.0`, `:0.3`, `:0`, `:latest`)

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
