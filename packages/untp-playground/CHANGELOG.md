# Changelog

All notable changes to the UNTP Playground are documented in this file. The
format is loosely based on [Keep a Changelog](https://keepachangelog.com/)
and the version numbers follow semantic versioning. Production releases are
shipped as Docker images tagged from the `untp-playground-v<X.Y.Z>` git tag.

## [0.4.0] - 2026-09-18

### ⚠ BREAKING CHANGES

- **`conformitySchemeResults` is now `conformitySchemes`** in the JSON report, and the three family arrays (`verifiableCredentials`, `conformitySchemes`, `linkSets`) are always present, empty when nothing of that family is loaded. The HTML report heads a scheme block with the card's title instead of falling back to the type and version; the JSON `name` field is unchanged. Every entry drops the duplicate `overallStatus` field; `status` remains. The report also records link sets, groups credentials by type with instance counts, and carries link-set provenance for credentials verified from a link set. ([#1021](https://github.com/uncefact/tests-untp/pull/1021)) ([4a42e50](https://github.com/uncefact/tests-untp/commit/4a42e502a9b1e3f1e17fc5cb336358292f3767a5))

### Added

- **Structural Conformity Scheme parsing.** Scheme verification now runs `Version Detection`, `Schema Validation`, `Structural Parse` and `JSON-LD Document Expansion and Context Validation`; the parser-backed step checks required root, profile and criterion fields and records skipped or blocked steps in the result. ([#1075](https://github.com/uncefact/tests-untp/pull/1075)) ([b38b2b9](https://github.com/uncefact/tests-untp/commit/b38b2b947c70bcb189f39c2f979885394bfb1395))
- **Relation-aware link type coverage.** Check linked credentials against the `dpp`, `dcc`, `dfr` or `dte` relation under which each was published, recording pending, matching and mismatching outcomes. ([#1020](https://github.com/uncefact/tests-untp/pull/1020)) ([8aa0af1](https://github.com/uncefact/tests-untp/commit/8aa0af1709b35f177a4a3f438b6797b6159b2432))
- **Selected-version link set validation.** Validate link sets against the UNTP Identity Resolver schema for the spec version selected when they are added. ([#1019](https://github.com/uncefact/tests-untp/pull/1019)) ([9a64cda](https://github.com/uncefact/tests-untp/commit/9a64cda83a8251b780a73b3da4e9e072c6e9eebb))
- **Browser decryption for supported encrypted credentials.** Decrypt the reference storage service's AES-256-GCM envelope in the browser before running the normal credential pipeline. ([#978](https://github.com/uncefact/tests-untp/pull/978)) ([4cb399d](https://github.com/uncefact/tests-untp/commit/4cb399d04c9f42d33272e69c155da278ff4cd850))
- **Secondary resolver actions.** Resolve secondary identity resolver links from link set cards as additional link set instances. ([#977](https://github.com/uncefact/tests-untp/pull/977)) ([c5c6524](https://github.com/uncefact/tests-untp/commit/c5c6524482e77f01d4bb1a5a929b7e1d608b9467))
- **Linked credential verification.** Fetch credential targets from resolved link set cards through the credential validation pipeline. ([#975](https://github.com/uncefact/tests-untp/pull/975)) ([b5e0976](https://github.com/uncefact/tests-untp/commit/b5e0976fc3d3bc054ecf3ba06b6a161d3461fe3c))
- **Tab-scoped upload controls.** Scope the uploader sidebar and sample downloads to the active Credentials, Conformity Schemes or Link Sets tab. ([#971](https://github.com/uncefact/tests-untp/pull/971)) ([f721554](https://github.com/uncefact/tests-untp/commit/f721554c95cae396b22614d2a68500e37f0f3def))
- **Identity Resolver link sets.** Add link set uploads, resolver URL resolution, credential-link cards and link set samples to the Playground. ([#970](https://github.com/uncefact/tests-untp/pull/970)) ([257194e](https://github.com/uncefact/tests-untp/commit/257194e10663554e95a975affa067edc4dced1bd))
- **Tab status metadata.** Show loaded instance counts, failure markers and credential verification progress in the tab labels. ([#967](https://github.com/uncefact/tests-untp/pull/967)) ([2df2da9](https://github.com/uncefact/tests-untp/commit/2df2da9a9758a2564bdc63bdb331bb66800fdeaa))
- **Multiple credential instances.** Keep multiple credentials of the same type as separate instances and group them under shared type headings. ([#861](https://github.com/uncefact/tests-untp/pull/861)) ([f6bca21](https://github.com/uncefact/tests-untp/commit/f6bca2160dd0feca188a01dc7c4fa4f47e47e158))
- **Multiple Conformity Scheme instances.** Support loading and validating more than one Conformity Scheme in the same session. ([dd6ad31](https://github.com/uncefact/tests-untp/commit/dd6ad31b6a5e8cd7056e0bf4efd969077465c743))
- **Tabbed artefact surface.** Add separate Credentials, Conformity Schemes and Link Sets tabs. ([a56dcd6](https://github.com/uncefact/tests-untp/commit/a56dcd653134532f77428505f05261f00a2ca5be))

### Changed

- **Artefact-step failure classes.** Carry `could-not-fetch`, `unusable-artefact`, `credential-invalid` or `unknown` classifications, diagnostics and remediation through validation steps, cards, details and JSON reports; bound schema and context reads and settle unexpected pipeline throws. ([#1076](https://github.com/uncefact/tests-untp/pull/1076)) ([ea05e27](https://github.com/uncefact/tests-untp/commit/ea05e27a349a0c3d2d8410443eeea228ef61a4d1))
- **Shared UNTP artefact detection.** Use `untp-utils` artefact detection and URL builders for version detection, context scanning and schema selection while preserving supported published schema URLs. ([#1067](https://github.com/uncefact/tests-untp/pull/1067)) ([fcf6847](https://github.com/uncefact/tests-untp/commit/fcf6847abf46b952f61cd95bae23b1f609166513))
- **Guarded JSON-LD context loading.** Expand contexts through the shared `untp-utils` guarded loader and carry its structured failure details into validation results. ([#1014](https://github.com/uncefact/tests-untp/pull/1014)) ([3ee4397](https://github.com/uncefact/tests-untp/commit/3ee4397e8165baf398fbce6ba1239555d7f44be1))
- **Guarded schema loading.** Fetch schemas through the shared `untp-utils` guarded loader and preserve bundled fallback and structured schema failures. ([#1010](https://github.com/uncefact/tests-untp/pull/1010)) ([b4de0b2](https://github.com/uncefact/tests-untp/commit/b4de0b2fd405f0553db871d5c1f296e1651632e7))
- **Package licence metadata.** Align the Playground package licence with its distribution model. ([#635](https://github.com/uncefact/tests-untp/pull/635)) ([90b553f](https://github.com/uncefact/tests-untp/commit/90b553f6490d20c53d52f91f993105e5bd39b84f))

### Fixed

- **Guarded URL retrieval.** Route `/api/fetch` through the shared `untp-utils` resolver with one bounded budget across DNS, redirects, transport and body reading, with validated redirect destinations and sanitised failures. ([#1066](https://github.com/uncefact/tests-untp/pull/1066)) ([e345892](https://github.com/uncefact/tests-untp/commit/e34589280de37eba949772b0d556c5bf658fe26d))
- **Credential validity windows.** After the verification service reports success, judge `validFrom` and `validUntil` from the credential claims and fail expired or not-yet-valid credentials. ([#1055](https://github.com/uncefact/tests-untp/pull/1055)) ([9595660](https://github.com/uncefact/tests-untp/commit/95956608f2b11dbc86e34c7cbfc742aa86df89b5))

### Documentation

- **Playground README.** Correct the Playground README after the v0.4 arc. ([#945](https://github.com/uncefact/tests-untp/pull/945)) ([0ff22d7](https://github.com/uncefact/tests-untp/commit/0ff22d7c881681feb38683449324d002d00a591e))

## [0.3.0] - 2026-05-15

### Added

- **ConformityScheme validation.** Accept JSON-LD ConformityScheme documents
  alongside Verifiable Credentials, from a file upload or pasted URL. New
  three-step pipeline runs version detection, schema validation, and
  JSON-LD context expansion in its own "Conformity Schemes" section, mirroring
  the existing credential pipeline.
- **Server-side `/api/fetch` route.** URL-supplied artefacts are fetched
  through a Next.js route with SSRF mitigations: HTTPS-only, RFC1918 /
  loopback / link-local hosts blocked as literal IPs and after DNS
  resolution, 10 second timeout, three redirect hops, 10 MB body cap.
- **Source provenance in the report and UI.** Source filename or URL
  surfaces under each expanded credential and scheme card, and is included
  in the JSON report under each result's `source` field.
- **Sample download buttons.** "Download test files" section in the right
  column offers "Test Credential (DPP)" and "Test Conformity Scheme"
  samples (`public/samples/*-v0.7.0.json`).
- **Configurable report branding and footer links.** Header eyebrow, title,
  and footer all derive from `NEXT_PUBLIC_REPORT_NAME` (default `UNTP`);
  the "Generated by ... Playground" link points at
  `NEXT_PUBLIC_PLAYGROUND_URL`; the test-runner link points at
  `NEXT_PUBLIC_TEST_SUITE_URL` (default: this repository).
- **Distinct playground and test-runner versions.** Header chip shows the
  playground build version (`NEXT_PUBLIC_PLAYGROUND_VERSION`); the report
  footer's "Test runner" line carries the conformance suite version
  (`NEXT_PUBLIC_TEST_SUITE_VERSION`). Both default to the playground's own
  `package.json` version today and can diverge once the suite ships as its
  own package.

### Changed

- **Conformance report redesigned.** New editorial single-column template
  with status pills, dashed step dividers, and a Geist (system-fallback)
  type stack. The JSON payload now carries `verifiableCredentials` and
  `conformitySchemeResults` arrays, each result with its own
  `overallStatus`. Dates render as `D MMMM YYYY` (en-GB).
- **Results section retitled.** The credential results heading is now
  "Verifiable Credentials" (was "Your Credentials") so it pairs with the
  new "Conformity Schemes" section.
- **Credential cards.** Removed the proof-type chip; VCDM version chip
  retained.
- **Scheme pipeline error feedback.** Failures surface with a typed error
  reason (timeout, not-found, parse, network), a 15 second schema-fetch
  timeout, and an inline "report an issue" link wired to
  `NEXT_PUBLIC_SUPPORT_URL`.
- **Confetti.** Fires once when a ConformityScheme reaches green across all
  pipeline steps, matching credential behaviour.

### Fixed

- Prefix `NEXT_PUBLIC_BASE_PATH` on the new `/api/fetch` and `/api/schema`
  callers so the playground works under a path prefix.
- Defensive guard on `detectCredentialType` so non-array `type` fields
  (e.g. when a JSON Schema is pasted by mistake) no longer crash the page.
- Inline error states never auto-dismiss as toasts; URL stays in the input
  on failure so the user can correct and retry.
- Static asset paths in the playground Docker image align with the
  Next.js standalone tracing root, so CSS and JS load correctly under the
  workspace layout.
- Dedupe concurrent schema fetches for the same URL.
- JSON-LD and schema validation errors render with actionable context.

[0.4.0]: https://github.com/uncefact/tests-untp/releases/tag/untp-playground-v0.4.0
[0.3.0]: https://github.com/uncefact/tests-untp/releases/tag/untp-playground-v0.3.0
