/**
 * Smoke test for the services-level CVC pipeline against the deployed UNTP
 * register. Skips Prisma persistence entirely; exercises only the
 * fetch / JSON parse / schema validation / JSON-LD expansion / parse gates.
 *
 * Usage:
 *   pnpm exec tsx scripts/cvc-smoke.ts
 *
 * No Docker, no database, no Next.js needed.
 */
import { parseConformityCatalogue } from '@uncefact/untp-utils/conformity-vocabulary';
import { makeSchemaLoader } from '@uncefact/untp-utils/schema-loaders';
import { makeInMemoryTtlCache } from '@uncefact/untp-utils/cache';
import { resolveAndParseConformityScheme } from '@uncefact/untp-ri-services/cvc';

const REGISTER_URL = 'https://untp.unece.org/assets/files/register-aac7758c2e3fe71fa2309ca898d66d55.json';
const SCHEMA_URL = 'https://untp.unece.org/artefacts/schema/v0.7.0/cvc/ConformityScheme.json';

async function main() {
  const schemaLoader = makeSchemaLoader(makeInMemoryTtlCache<object>({ ttlMs: 60 * 60 * 1000 }));

  console.log(`Fetching register: ${REGISTER_URL}`);
  const registerResp = await fetch(REGISTER_URL, { headers: { Accept: 'application/json' } });
  if (!registerResp.ok) {
    console.error(`Register fetch failed: ${registerResp.status} ${registerResp.statusText}`);
    process.exit(1);
  }
  const registerDoc = await registerResp.json();
  const { entries } = parseConformityCatalogue(registerDoc, { sourceUrl: REGISTER_URL });
  console.log(`Parsed ${entries.length} catalogue entries.\n`);

  let successCount = 0;
  let failureCount = 0;

  for (const entry of entries) {
    console.log(`=== ${entry.name} ===`);
    console.log(`  canonicalId:   ${entry.canonicalId}`);
    console.log(`  vocabularyUrl: ${entry.vocabularyUrl}`);

    const result = await resolveAndParseConformityScheme({
      sourceUrl: entry.vocabularyUrl,
      source: 'UNTP',
      tenantId: 'smoke-tenant',
      conformitySchemaUrl: SCHEMA_URL,
      schemaLoader,
    });

    if (result.kind === 'failure') {
      failureCount += 1;
      console.error(`  → FAILURE: ${result.error.status} (${result.error.code})`);
      console.error(`    message: ${result.error.message}`);
      const cause = result.error.cause as Error | undefined;
      if (cause) console.error(`    cause:   ${cause.message ?? cause}`);
    } else if (result.kind === 'unchanged') {
      console.log(`  → UNCHANGED (no body to inspect)`);
      successCount += 1;
    } else {
      successCount += 1;
      console.log(`  → SUCCESS`);
      console.log(`    parsed name:        ${result.scheme.name}`);
      console.log(`    parsed canonicalId: ${result.scheme.canonicalId}`);
      console.log(`    register canonical: ${entry.canonicalId}`);
      console.log(`    specVersion:        ${result.scheme.specVersion}`);
      console.log(
        `    owner:              ${result.scheme.owner?.name ?? '(none)'} (${result.scheme.owner?.canonicalId ?? '-'})`,
      );
      console.log(`    profiles:           ${result.scheme.profiles.length}`);
      for (const profile of result.scheme.profiles) {
        console.log(`      - ${profile.name} (v${profile.version}, status=${profile.status})`);
        console.log(`        id:       ${profile.canonicalId}`);
        console.log(`        criteria: ${profile.criteria.length}`);
        for (const criterion of profile.criteria.slice(0, 3)) {
          console.log(`          • ${criterion.name} (v${criterion.version})`);
          console.log(`            ${criterion.canonicalId}`);
        }
        if (profile.criteria.length > 3) {
          console.log(`          … +${profile.criteria.length - 3} more`);
        }
      }
      console.log(`    bodyDigest:         ${result.bodyDigest.toString()}`);
      if (result.etag) console.log(`    etag:               ${result.etag}`);
      if (result.lastModifiedHeader) console.log(`    lastMod:            ${result.lastModifiedHeader}`);
    }
    console.log('');
  }

  console.log(`Summary: ${successCount} success, ${failureCount} failure.`);
  process.exit(failureCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
