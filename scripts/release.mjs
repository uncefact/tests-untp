#!/usr/bin/env node

/**
 * Build the publishable libraries and invoke `changeset publish`, optionally
 * skipping packages named in the `PUBLISH_IGNORE` env var.
 *
 * `PUBLISH_IGNORE` is a comma-separated list of fully-qualified package
 * names (e.g. `@uncefact/untp-utils,@uncefact/untp-ri-services`). It is
 * populated by `.github/workflows/release.yml` from `hold:<name>` labels
 * applied to the Version Packages PR before merge.
 *
 * Each name becomes a `--ignore <name>` flag passed to changeset publish.
 * Held packages keep their bumped version + changelog entry on `next`
 * (since the Version Packages PR has already merged) but are not published
 * to npm in this run. The next release will pick them up automatically
 * because their changeset entries have already been consumed.
 */

import { spawnSync } from 'node:child_process';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: false, ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run('pnpm', ['--filter', '@uncefact/untp-utils', 'run', 'build']);
run('pnpm', ['--filter', '@uncefact/untp-ri-services', 'run', 'build']);

const rawIgnore = process.env.PUBLISH_IGNORE ?? '';
const ignored = rawIgnore
  .split(',')
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

const publishArgs = ['publish'];
for (const name of ignored) {
  publishArgs.push('--ignore', name);
}

if (ignored.length > 0) {
  console.log(`Publishing with --ignore for: ${ignored.join(', ')}`);
} else {
  console.log('Publishing all bumped packages (no PUBLISH_IGNORE entries).');
}

run('pnpm', ['exec', 'changeset', ...publishArgs]);
