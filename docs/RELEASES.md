# Releases

This repository ships four release artefacts on independent cadences. Each
owns its own tag prefix, its own publish workflow, and its own changelog.

| Artefact | Type | Tag prefix | Workflow | Registry |
|---|---|---|---|---|
| `@uncefact/untp-utils` | npm package | `untp-utils-v` | `publish-untp-utils.yml` | npmjs.com |
| `@uncefact/untp-ri-services` | npm package | `untp-ri-services-v` | `publish-untp-ri-services.yml` | npmjs.com |
| Reference Implementation | Docker image | `reference-implementation-v` | `docker-ri.yml` | ghcr.io |
| UNTP Playground | Docker image | `untp-playground-v` | `docker-playground.yml` | ghcr.io |

The decision behind this layout is recorded in
[ADR 031](./adrs/031-per-package-tag-triggered-npm-release.md).

## Cutting a stable release

1. **Bump the version** in the artefact's `package.json` on `next` (via a
   normal PR). For example, for `@uncefact/untp-utils`:

   ```bash
   pnpm --filter '@uncefact/untp-utils' exec npm version --no-git-tag-version <patch|minor|major>
   ```

   Note the `exec npm version` rather than a bare `pnpm version`. With `--filter`,
   pnpm resolves `version` to a `version` script in the package and fails with
   `None of the selected packages has a "version" script`.

   Open a PR titled `chore(release): @uncefact/untp-utils v<X.Y.Z>` and
   include the changelog entry for this release.

2. **Merge the PR.** No tag yet — merging the version bump and tagging are
   separate steps so the tag always points at a commit that contains the
   matching `package.json` version.

3. **Tag the merge commit and push the tag.** The tag is the release event;
   the publish workflow fires from the tag push.

   ```bash
   git fetch origin
   git checkout next
   git pull
   git tag -a untp-utils-v<X.Y.Z> -m "@uncefact/untp-utils v<X.Y.Z>"
   git push origin untp-utils-v<X.Y.Z>
   ```

4. **Verify.** Watch the workflow run under the **Actions** tab. The publish
   workflow:
   - Checks out the tagged commit and verifies the SHA.
   - Verifies the tag version matches the `package.json` version (fails the
     workflow if not, before any publish call).
   - Builds the package.
   - Publishes to npm with `--provenance` via OIDC Trusted Publishing,
     tagging the release as `latest`.

   Confirm the new version appears at `https://www.npmjs.com/package/@uncefact/<package-name>`
   and that `npm view @uncefact/<pkg> versions --tags` shows `latest:
   <X.Y.Z>`.

## Cutting a pre-release (RC / alpha / beta)

Pre-release tags carry a SemVer suffix on the version. The workflow detects
the suffix and publishes to the `rc` dist-tag instead of `latest`, so
`npm install @uncefact/<pkg>` continues to resolve to the last stable.

```bash
git tag -a untp-utils-v<X.Y.Z>-rc.1 -m "@uncefact/untp-utils v<X.Y.Z>-rc.1"
git push origin untp-utils-v<X.Y.Z>-rc.1
```

Supported suffixes (each maps to `rc`):

- `-rc.N` (release candidate)
- `-alpha.N`
- `-beta.N`
- `-pre.N`

Consumers opt into pre-releases with `npm install @uncefact/<pkg>@rc`.

To promote an RC to stable, push a new tag without the suffix:

```bash
git tag -a untp-utils-v<X.Y.Z> -m "@uncefact/untp-utils v<X.Y.Z>"
git push origin untp-utils-v<X.Y.Z>
```

The stable release is built from the same commit (or a later one) and
takes over the `latest` dist-tag.

## Rolling back

Mistakes happen. The `npm rollback or archive` workflow
(`unpublish-or-deprecate.yml`) handles withdrawal in two ways. **Both run
via the Actions tab → "Run workflow" form, never from a tag push** — a
rollback is a deliberate manual action.

### Within 72 hours of publish: unpublish

npm allows unpublishing a version within 72 hours of its first publish, and
only when no other packages depend on it. Use this when you catch a broken
release quickly.

1. Actions → **npm rollback or archive** → Run workflow.
2. Select the package, fill in the version, choose `unpublish`, and add a
   short reason.
3. The workflow runs `npm unpublish <pkg>@<version>`.

If npm rejects the request (outside the window, or dependants exist), the
workflow fails. Re-run with `deprecate` instead.

### Beyond 72 hours, or with dependants: deprecate

`npm deprecate` archives the version: it stays installable, but
`npm install` emits a warning and the version is hidden from typical
version listings. This is the long-term path for broken releases that
cannot be unpublished.

1. Actions → **npm rollback or archive** → Run workflow.
2. Select the package, version, choose `deprecate`, and write a message
   consumers will see (e.g. "Broken — use 0.5.2 or later").

`npm install @uncefact/<pkg>` will skip the deprecated version when a
non-deprecated version satisfies the requested range, and emit a warning
when the deprecated version is the only match.

## Docker releases (RI and Playground)

The reference implementation and the playground follow the same
tag-triggered pattern, but the workflow builds a Docker image and pushes
it to `ghcr.io/uncefact/tests-untp/<image>` instead of an npm publish.
See `.github/workflows/docker-ri.yml` and
`.github/workflows/docker-playground.yml`.

Tag patterns for these are documented in the workflows themselves and on
their respective release-notes documents (`packages/<dir>/RELEASE_NOTES.md`).

## When something looks wrong

- **Tag pushed but no workflow run.** Check that the tag name starts with
  the right prefix (e.g. `untp-utils-v` not `utils-v`). Tag globs are
  exact-prefix matches.
- **Workflow ran but no npm publish happened.** Look for the
  `Verify tag/package version match` step. The workflow refuses to publish
  if `package.json` and the tag version disagree.
- **Publish failed with auth error.** Confirm the package is configured as
  a Trusted Publisher on npmjs.com pointing at the workflow filename. The
  Trusted Publisher entry must match `uncefact/tests-untp` (owner/repo)
  and the specific workflow YAML path.
