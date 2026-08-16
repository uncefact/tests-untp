/**
 * Backfill: transcode legacy hex sha-256 digests to multibase-encoded
 * multihash on existing Credential and RenderTemplate rows.
 *
 * Pairs with migration `20260519000000_rename_hash_to_digest_multibase`,
 * which renames the column from `hash` to `digestMultibase`. After that
 * rename, the column still contains the legacy hex values from before the
 * migration; this script transcodes those values in place.
 *
 * Idempotent: rows whose value already parses as a multibase-encoded
 * multihash (the `MultibaseDigest.fromString` parse succeeds) are left
 * alone. Safe to run multiple times. The script never re-fetches content
 * from storage and never touches the `storageUri` / `storageUrl` field, so
 * external references to the credential or render template remain stable.
 *
 * Runs automatically from docker-entrypoint.sh because its writes can be
 * turned back: a converted value carries the same digest bytes in another
 * encoding, recoverable through `MultibaseDigest.fromString` without the
 * content or any secret. See docs/adrs/043-data-backfill-conventions.md for
 * when a backfill is auto-run rather than operator-run, and for the
 * constraints new auto-run backfills meet that this one predates (it loads
 * both tables in one query rather than paginating).
 */

import { PrismaClient } from '../../src/lib/prisma/generated/index.js';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';

type BackfillStats = { scanned: number; transcoded: number; skipped: number; unknown: number };

function classifyAndTranscode(value: string): { action: 'skip' | 'transcode'; next?: string; reason?: string } {
  // Already a valid multibase string: skip.
  try {
    MultibaseDigest.fromString(value);
    return { action: 'skip' };
  } catch {
    // Not multibase; try the legacy hex shape.
  }

  try {
    const next = MultibaseDigest.fromHex(value, { algorithm: 'sha2-256', base: 'base58btc' }).toString();
    return { action: 'transcode', next };
  } catch {
    return { action: 'skip', reason: 'unknown-format' };
  }
}

async function backfillCredentials(prisma: PrismaClient): Promise<BackfillStats> {
  const stats: BackfillStats = { scanned: 0, transcoded: 0, skipped: 0, unknown: 0 };

  const rows = await prisma.credential.findMany({ select: { id: true, digestMultibase: true } });

  for (const row of rows) {
    stats.scanned += 1;
    const { action, next, reason } = classifyAndTranscode(row.digestMultibase);

    if (action === 'transcode' && next) {
      await prisma.credential.update({
        where: { id: row.id },
        data: { digestMultibase: next },
      });
      stats.transcoded += 1;
    } else if (reason === 'unknown-format') {
      stats.unknown += 1;
      console.warn(
        `[backfill] Credential ${row.id} has digestMultibase in an unrecognised format; leaving as-is. Value: ${row.digestMultibase}`,
      );
    } else {
      stats.skipped += 1;
    }
  }

  return stats;
}

async function backfillRenderTemplates(prisma: PrismaClient): Promise<BackfillStats> {
  const stats: BackfillStats = { scanned: 0, transcoded: 0, skipped: 0, unknown: 0 };

  const rows = await prisma.renderTemplate.findMany({ select: { id: true, digestMultibase: true } });

  for (const row of rows) {
    stats.scanned += 1;
    const { action, next, reason } = classifyAndTranscode(row.digestMultibase);

    if (action === 'transcode' && next) {
      await prisma.renderTemplate.update({
        where: { id: row.id },
        data: { digestMultibase: next },
      });
      stats.transcoded += 1;
    } else if (reason === 'unknown-format') {
      stats.unknown += 1;
      console.warn(
        `[backfill] RenderTemplate ${row.id} has digestMultibase in an unrecognised format; leaving as-is. Value: ${row.digestMultibase}`,
      );
    } else {
      stats.skipped += 1;
    }
  }

  return stats;
}

async function main() {
  const prisma = new PrismaClient();

  try {
    console.log('[backfill] Transcoding hex sha-256 -> multibase on Credential ...');
    const credentialStats = await backfillCredentials(prisma);
    console.log(`[backfill] Credential: ${JSON.stringify(credentialStats)}`);

    console.log('[backfill] Transcoding hex sha-256 -> multibase on RenderTemplate ...');
    const renderTemplateStats = await backfillRenderTemplates(prisma);
    console.log(`[backfill] RenderTemplate: ${JSON.stringify(renderTemplateStats)}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[backfill] Failed:', err);
  process.exit(1);
});
