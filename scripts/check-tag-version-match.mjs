#!/usr/bin/env node

/**
 * Verify that a release tag's version matches the version recorded in the
 * package's package.json.
 *
 * Used by the per-package publish workflows (see ADR 031). The workflow
 * passes the package name, the package directory, and the expected tag
 * prefix; this script reads the tag from the workflow's `github.ref_name`
 * input (passed via `GITHUB_REF_NAME` env var or first CLI arg) and the
 * package.json version, then asserts they match. Fails loudly on mismatch
 * so a half-published release cannot proceed.
 *
 * Usage:
 *   node scripts/check-tag-version-match.mjs <tagPrefix> <packageDir>
 *
 * Example:
 *   node scripts/check-tag-version-match.mjs untp-utils-v packages/untp-utils
 *
 * The tag name is read from `process.env.GITHUB_REF_NAME` first; falls
 * back to `process.argv[4]` if the env var is empty (useful for local
 * testing).
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exit } from 'node:process';

const [, , tagPrefix, packageDirArg, refNameArg] = process.argv;

if (!tagPrefix || !packageDirArg) {
  console.error('Usage: node scripts/check-tag-version-match.mjs <tagPrefix> <packageDir> [refName]');
  exit(2);
}

const refName = process.env.GITHUB_REF_NAME || refNameArg;
if (!refName) {
  console.error('No tag name supplied. Set GITHUB_REF_NAME or pass it as the third argument.');
  exit(2);
}

if (!refName.startsWith(tagPrefix)) {
  console.error(`Tag "${refName}" does not start with the expected prefix "${tagPrefix}".`);
  exit(1);
}

const tagVersion = refName.slice(tagPrefix.length);
if (!tagVersion) {
  console.error(`Tag "${refName}" has no version segment after prefix "${tagPrefix}".`);
  exit(1);
}

const packageJsonPath = resolve(join(packageDirArg, 'package.json'));
let pkg;
try {
  pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
} catch (err) {
  console.error(`Could not read ${packageJsonPath}: ${err.message}`);
  exit(2);
}

const pkgVersion = pkg.version;
if (!pkgVersion) {
  console.error(`${packageJsonPath} has no "version" field.`);
  exit(2);
}

if (pkgVersion !== tagVersion) {
  console.error(
    `Tag/package mismatch. Tag "${refName}" implies version "${tagVersion}" but ${packageJsonPath} declares "${pkgVersion}".\n` +
      `Bump the version in package.json to match the tag (or retag the commit) and re-run.`,
  );
  exit(1);
}

console.log(`OK: tag "${refName}" matches ${pkg.name}@${pkgVersion}.`);
