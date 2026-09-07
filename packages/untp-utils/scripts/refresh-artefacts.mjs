#!/usr/bin/env node
/**
 * Refreshes the bundled UNTP schema and JSON-LD context artefacts, and checks
 * the bundle against what is published.
 *
 * For each entry in ARTEFACTS, fetch the artefact from its source of truth
 * and compare it with the bundled copy. A new entry is written; an existing
 * entry that matches is left alone; an existing entry that differs makes the
 * script fail naming the artefact, unless --force is given. Published
 * artefacts are immutable once released, so a difference is an upstream
 * change to investigate, not something to absorb silently.
 *
 * Sources: spec versions from 0.7.0 come from the spec repository at their
 * release tag (https://opensource.unicc.org/un/unece/uncefact/spec-untp,
 * `artefacts/`), which stays reachable when the Pages host is down. Earlier
 * versions predate that repository and come from the publishing host.
 *
 * Usage: node scripts/refresh-artefacts.mjs [--check] [--force]
 *   --check   dry run: fetch and compare only, report what a refresh would add or
 *             refuse, write nothing, exit 1 on any difference or missing copy
 *   --force   overwrite bundled copies that differ (after investigating)
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.UNTP_ARTEFACTS_ROOT ?? join(dirname(fileURLToPath(import.meta.url)), '..');
const ARTEFACT_DIR = join(ROOT, 'artefacts');
const BUNDLE_DIR = join(ROOT, 'src', 'bundle');
const GITLAB = 'https://opensource.unicc.org/api/v4/projects/un%2Funece%2Funcefact%2Fspec-untp/repository/files';
const LEGACY_BASE = 'https://test.uncefact.org/vocabulary/untp';

const gitlabRaw = (path, tag) => `${GITLAB}/${encodeURIComponent(path)}/raw?ref=${tag}`;

/** The v0.7.0 core schema files per short type, as laid out in the spec repository. */
const V070_SCHEMAS = {
  dpp: 'DigitalProductPassport',
  dcc: 'ConformityCredential',
  dfr: 'DigitalFacilityRecord',
  dia: 'DigitalIdentityAnchor',
  dte: 'DigitalTraceabilityEvent',
  cvc: 'ConformityScheme',
};
const LEGACY_TYPES = ['dpp', 'dcc', 'dfr', 'dia', 'dte'];
const LEGACY_VERSIONS = ['0.6.0', '0.6.1'];

/**
 * Every bundled artefact: the URL consumers request, where to fetch the
 * canonical copy, and the bundled file. Files follow one layout regardless of
 * how the publishing host names them: `<schema|context>/<family>/<version>/<name>.json`,
 * where the family is `untp` or `vcdm` and the name is the UNTP short type
 * (`dpp`, `cvc`, `linkset`), `untp` for the unified 0.7.0 context, or the
 * VCDM document name.
 */
export const ARTEFACTS = [
  // The W3C Verifiable Credentials Data Model v2: the context every credential
  // declares first, and the schema the Playground validates the envelope with.
  {
    url: 'https://www.w3.org/ns/credentials/v2',
    source: 'https://www.w3.org/ns/credentials/v2',
    file: 'context/vcdm/2/credentials.json',
  },
  {
    url: 'https://w3c.github.io/vc-data-model/schema/verifiable-credential/verifiable-credential-schema.json',
    source: 'https://w3c.github.io/vc-data-model/schema/verifiable-credential/verifiable-credential-schema.json',
    file: 'schema/vcdm/2/verifiable-credential.json',
  },
  ...Object.entries(V070_SCHEMAS).map(([short, file]) => ({
    url: `https://untp.unece.org/artefacts/schema/v0.7.0/${short}/${file}.json`,
    source: gitlabRaw(`artefacts/schema/v0.7.0/${short}/${file}.json`, 'v0.7.0'),
    file: `schema/untp/0.7.0/${short}.json`,
  })),
  {
    url: 'https://untp.unece.org/artefacts/schema/v0.7.0/idr/LinksetSchema.json',
    source: gitlabRaw('artefacts/schema/v0.7.0/idr/LinksetSchema.json', 'v0.7.0'),
    file: 'schema/untp/0.7.0/linkset.json',
  },
  {
    url: 'https://vocabulary.uncefact.org/untp/0.7.0/context/',
    source: gitlabRaw('artefacts/contexts/v0.7.0/untp-context.jsonld', 'v0.7.0'),
    file: 'context/untp/0.7.0/untp.json',
  },
  ...LEGACY_VERSIONS.flatMap((version) =>
    LEGACY_TYPES.flatMap((short) => [
      {
        url: `${LEGACY_BASE}/${short}/untp-${short}-schema-${version}.json`,
        source: `${LEGACY_BASE}/${short}/untp-${short}-schema-${version}.json`,
        file: `schema/untp/${version}/${short}.json`,
      },
      {
        // The identifier the 0.6.x schemas declare (and credentials carry) has
        // no `context/` segment; the host serves the same document at both.
        url: `${LEGACY_BASE}/${short}/${version}/`,
        aliases: [`${LEGACY_BASE}/${short}/${version}/context/`],
        source: `${LEGACY_BASE}/${short}/${version}/`,
        file: `context/untp/${version}/${short}.json`,
      },
    ]),
  ),
];

const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/** Stored form of a bundled artefact. */
const canonical = (json) => JSON.stringify(json, null, 2) + '\n';

async function fetchJson(url, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { accept: 'application/ld+json, application/schema+json, application/json' },
    });
  } catch (cause) {
    throw new Error(`${url}: could not be fetched (${cause?.cause?.code ?? cause?.message ?? cause})`, { cause });
  }
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  try {
    return await res.json();
  } catch (cause) {
    throw new Error(`${url}: body is not JSON`, { cause });
  }
}

async function readBundled(file) {
  try {
    return await readFile(join(ARTEFACT_DIR, file), 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw err;
  }
}

/** Recursively sorts object keys (arrays keep their order) so two documents compare by content. */
export function canonicalise(value) {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalise(value[key])]),
    );
  }
  return value;
}

const canonicalText = (json) => JSON.stringify(canonicalise(json));

/**
 * Compares a fetched artefact with the bundled copy by content (whitespace and
 * property order ignored), so a formatter touching the bundled file never
 * reads as upstream drift. Pure so it can be tested.
 */
export function classify(bundledText, fetchedText) {
  if (bundledText === undefined) return 'missing';
  let bundled;
  try {
    bundled = JSON.parse(bundledText);
  } catch {
    return 'corrupt';
  }
  return canonicalText(bundled) === canonicalText(JSON.parse(fetchedText)) ? 'same' : 'differs';
}

/** Hash of the artefact's content in canonical form, independent of file formatting and property order. */
const contentHash = (text) => sha256(canonicalText(JSON.parse(text)));

const moduleName = (file) => file.replace(/\.json$/, '').replace(/[^a-zA-Z0-9]+/g, '_');

async function writeBundleModules(entries) {
  const lines = ['// Generated by scripts/refresh-artefacts.mjs. Do not edit by hand.', ''];
  const mapLines = [];
  for (const { url, aliases, file } of entries) {
    const name = moduleName(file);
    const text = await readFile(join(ARTEFACT_DIR, file), 'utf8');
    await mkdir(join(BUNDLE_DIR, 'artefacts', dirname(file)), { recursive: true });
    await writeFile(
      join(BUNDLE_DIR, 'artefacts', file.replace(/\.json$/, '.ts')),
      `// Generated by scripts/refresh-artefacts.mjs from ${file}. Do not edit by hand.\nconst artefact: Record<string, unknown> = ${text.trimEnd()};\nexport default artefact;\n`,
    );
    lines.push(`import ${name} from './artefacts/${file.replace(/\.json$/, '.js')}';`);
    mapLines.push(`  ['${url}', ${name}],`);
    for (const alias of aliases ?? []) mapLines.push(`  ['${alias}', ${name}],`);
  }
  lines.push(
    '',
    '/** Bundled artefacts keyed by the published URL consumers request. */',
    'export const BUNDLED_ARTEFACTS: ReadonlyMap<string, Record<string, unknown>> = new Map<string, Record<string, unknown>>([',
    ...mapLines,
    ']);',
    '',
  );
  const versions = [
    ...new Set(entries.map((e) => e.file.match(/^(?:schema|context)\/untp\/([^/]+)\//)?.[1]).filter(Boolean)),
  ].sort();
  lines.push(
    '/** UNTP versions the bundle carries, ascending. */',
    `export const BUNDLED_UNTP_VERSIONS: readonly string[] = ${JSON.stringify(versions)};`,
    '',
  );
  await writeFile(join(BUNDLE_DIR, 'index.ts'), lines.join('\n'));
}

/** The one-word outcome reported for an artefact on this run. */
function describeOutcome(state, check, write) {
  if (state === 'same') return 'same';
  if (state === 'missing') return check ? 'would add' : 'added';
  return write && !check ? 'overwritten' : 'would refuse';
}

export async function main(argv = process.argv.slice(2), { fetchImpl = globalThis.fetch } = {}) {
  const check = argv.includes('--check');
  const write = argv.includes('--force');
  if (check && write) {
    console.error('--check and --force are mutually exclusive: a check writes nothing.');
    process.exit(1);
  }
  const manifest = [];
  const problems = [];
  // Everything is fetched and compared before anything is written, so a
  // failed fetch part-way through leaves the tree exactly as it was.
  const pending = [];
  for (const entry of ARTEFACTS) {
    const fetched = canonical(await fetchJson(entry.source, fetchImpl));
    const bundled = await readBundled(entry.file);
    const state = classify(bundled, fetched);
    if (state === 'corrupt' && !write)
      problems.push(`${entry.file}: the bundled copy is not valid JSON; restore it or refresh with --force`);
    if (state === 'missing' && check) problems.push(`${entry.file}: not bundled`);
    if (state === 'differs' && !write)
      problems.push(`${entry.file}: published copy differs from the bundled one (${entry.source})`);
    const willWrite = !check && (state === 'missing' || ((state === 'differs' || state === 'corrupt') && write));
    if (willWrite) pending.push({ file: entry.file, text: fetched });
    const text = willWrite || state === 'missing' || state === 'corrupt' ? fetched : bundled;
    manifest.push({
      url: entry.url,
      ...(entry.aliases ? { aliases: entry.aliases } : {}),
      file: entry.file,
      source: entry.source,
      sha256: contentHash(text),
    });
    console.log(`${describeOutcome(state, check, write).padEnd(13)} ${entry.file}`);
  }
  if (problems.length) {
    console.error('\nRefresh refused:\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  if (check) {
    console.log(`\n${manifest.length} artefacts checked; nothing written.`);
    return;
  }
  for (const { file, text } of pending) {
    await mkdir(join(ARTEFACT_DIR, dirname(file)), { recursive: true });
    await writeFile(join(ARTEFACT_DIR, file), text);
  }
  await writeFile(join(ARTEFACT_DIR, 'manifest.json'), JSON.stringify({ artefacts: manifest }, null, 2) + '\n');
  await writeBundleModules(ARTEFACTS);
  console.log(`\n${manifest.length} artefacts bundled.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.stack ?? err.message);
    if (err.cause) console.error('cause:', err.cause);
    process.exit(1);
  });
}
