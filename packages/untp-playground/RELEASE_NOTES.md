# UNTP Playground release notes

These are the user-facing release notes for the UNTP Playground. They focus
on what's new for you, the person using the playground, not on the internal
mechanics. For a technical, per-change log see [CHANGELOG.md](./CHANGELOG.md).

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
