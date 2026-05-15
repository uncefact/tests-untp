# ADR: Per-package licensing policy

- **Date:** 2026-05-15
- **Status:** accepted

## Context

The repository is a monorepo that publishes some packages to npm (libraries
intended for third-party consumption) and ships others as user-facing
applications or internal-only workspace dependencies. Until now, no policy
documented which licence a new package should declare, and the existing
packages declared inconsistent values: the two library packages
(`@uncefact/untp-utils`, `@uncefact/untp-ri-services`) had `"license": "ISC"`
left over from package scaffolding, while the three user-facing packages
(`untp-reference-implementation`, `untp-playground`,
`@reference-implementation/components`) had no `license` field at all and
implicitly inherited the repository's root GPL-3.0 LICENSE.

Two forces drive the decision:

1. **Distribution model matters for licence choice.** Libraries published
   to npm are designed to be embedded in third-party products. A copyleft
   licence (GPL) on a library forces downstream products that link against
   it to also adopt the GPL, which is a significant adoption barrier and
   not the intent of these utility packages. User-facing applications and
   workspace-internal packages have no such reach concern: the GPL on a
   self-contained app is a deliberate signal that derivative works must
   stay free.
2. **Patent grant matters for libraries.** Apache-2.0 includes an explicit
   patent grant clause that protects downstream consumers from patent
   claims by contributors. GPL-3.0 has a weaker, derivative patent clause.
   For libraries we want consumers to integrate without legal friction,
   the explicit grant is valuable.

Without a documented policy, every new package risks repeating the same
ambiguity: copy-paste an old `package.json`, get whatever licence it had,
and ship a mismatched value to npm. Once a tagged release goes out under
the wrong licence, correcting it requires a new release and an audit of
who consumed the wrong version.

## Decision

Adopt the following per-package licensing policy:

- **Packages published to npm (libraries)** declare
  `"license": "Apache-2.0"` and ship a verbatim `LICENSE` file containing
  the Apache 2.0 text inside the package directory. The file ships in the
  npm tarball (npm bundles `LICENSE` files automatically) so consumers see
  the patent grant alongside the code.
- **User-facing applications and workspace-internal packages** declare
  `"license": "GPL-3.0-only"` and rely on the repository's root LICENSE
  for the full text. They do not need a per-package `LICENSE` file because
  they are not distributed as standalone artefacts via npm; they ship as
  Docker images or built bundles that inherit the source repository's
  licence by reference.

The SPDX identifier for the GPL packages is `GPL-3.0-only` (not
`GPL-3.0-or-later`) because the repository's root LICENSE is the verbatim
GPL-3.0 text and the project has not added an "or any later version"
notice anywhere. `-or-later` is only correct when the project explicitly
opts in to future GPL versions, which this project has not done.

Concrete package mapping at the time of this ADR:

| Package                                | Distribution   | Licence            |
|----------------------------------------|----------------|--------------------|
| `@uncefact/untp-utils`                 | npm (library)  | Apache-2.0         |
| `@uncefact/untp-ri-services`           | npm (library)  | Apache-2.0         |
| `untp-reference-implementation`        | Docker image   | GPL-3.0-only       |
| `untp-playground`                      | Docker image   | GPL-3.0-only       |
| `@reference-implementation/components` | workspace-only | GPL-3.0-only       |

When adding a new package, the maintainer picks the licence by asking
"will this be published to npm for third-party consumption?". If yes,
Apache-2.0 + per-package LICENSE file. If no, GPL-3.0-only and rely on
the root LICENSE.

## Consequences

What becomes easier:

- New library packages get the right licence by default; the policy is one
  rule keyed off "is this on npm?".
- npm consumers of the library packages get the patent grant in-tree, not
  via a remote root LICENSE they may never see.
- The user-facing apps remain clearly copyleft, which is consistent with
  the project's posture of keeping the reference implementation open.

What becomes harder:

- The repository now ships two licences. Anyone redistributing the
  monorepo as a whole (e.g. a fork) must understand that the per-package
  `LICENSE` files take precedence within their package directories. This
  is the standard monorepo pattern but it is more nuanced than a
  single-licence repo.
- If the project ever wants to migrate to `GPL-3.0-or-later` (to inherit
  future FSF GPL versions), that is now a deliberate two-step: add the
  "or any later version" notice to the root LICENSE / per-package
  manifests, then update the SPDX identifier. This ADR locks in `-only`
  to keep the SPDX identifier honest about current wording, not because
  `-or-later` would be wrong forever.

## Alternatives Considered

**Single licence across the whole repository (all Apache-2.0, or all
GPL-3.0).** Simpler to explain and easier for downstream redistributors.
Rejected because the two distribution models have genuinely different
needs: Apache-2.0 on the user-facing apps gives away copyleft protection
we want; GPL-3.0 on the libraries forces a copyleft cascade that defeats
the purpose of publishing utility libraries for third-party use. Picking
one licence to fit both models means one of them is wrong.

**MIT or ISC for the libraries.** Both are permissive and shorter to
read. Rejected because neither includes an explicit patent grant. For
libraries that may include cryptographic, identifier, or content-digest
primitives (where patent risk is non-trivial), Apache-2.0's explicit
grant is materially better than a permissive licence that is silent on
patents.

**`GPL-3.0-or-later` for the user-facing packages.** Rejected because the
project's root LICENSE is verbatim GPL-3.0 text and there is no "or any
later version" notice anywhere in the repository (no README clause, no
per-file headers). The SPDX identifier must match what the project's
licence notices actually say; using `-or-later` without an opt-in notice
would mislead consumers about the project's intent.

**No `license` field on the user-facing apps (status quo).** Works in
practice because the root LICENSE covers them implicitly, but tooling
(SBOM generators, dependency scanners, npm publish warnings) reads the
`license` field and reports "no licence declared" when it is missing.
Explicit is better than implicit.

## References

- Root [`LICENSE`](../../LICENSE) — GPL-3.0 text covering the repository.
- [`packages/untp-utils/LICENSE`](../../packages/untp-utils/LICENSE) and
  [`packages/services/LICENSE`](../../packages/services/LICENSE) — the
  per-package Apache-2.0 LICENSE files this ADR introduces.
- SPDX licence list: <https://spdx.org/licenses/>
- Apache 2.0 patent grant clause (section 3): <https://www.apache.org/licenses/LICENSE-2.0>
