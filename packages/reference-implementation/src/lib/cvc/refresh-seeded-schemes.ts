import type { LoggerService as Logger } from '@uncefact/untp-ri-services';
import { ConformitySchemeSource, Prisma, SeedEntryKind } from '../prisma/generated';
import { prisma } from '../prisma/prisma';
import { SYSTEM_TENANT_ID } from '../prisma/constants';
import { schemaLoader } from '../credentials/schema-loader';
import { ingestConformityScheme } from './ingest-conformity-scheme';
import { acquireCvcStructuralLock } from './cvc-structural-lock';

export interface SeededSchemeRefreshSummary {
  refreshed: number;
  unchanged: number;
  failed: number;
  skipped: number;
  criteriaSwept: number;
}

/**
 * Refreshes seeded (`SYSTEM_SEED`) conformity schemes from the database, so a
 * seed-only deployment (no `CVC_REGISTRY_URL`) picks up publisher updates
 * without a reboot. Every ingest input is reconstructed from the row itself:
 * `sourceUrl`, `specVersion`, and the schema URL via the core
 * `ConformityScheme` data-model binding. The seed manifest is not read; the
 * loader owns membership at boot, this pass owns content freshness between
 * boots.
 *
 * Only rows whose seed entry was a URL are re-fetched. FILE-seeded rows carry
 * their document id as `sourceUrl`, which may not be network-fetchable; they
 * refresh at boot from the mounted file. A row predating the
 * `seedEntryKind` marker is treated as URL when its `sourceUrl` is http(s).
 *
 * Failures follow the ingest contract: per-row, recorded on the row,
 * previous content retained, and never fatal to the pass. After the pass, a
 * tenant-scoped sweep removes criteria no profile references any more.
 *
 * @see ADR-033 §1 (Discovery and refresh; 2026-08-13 update) and #728.
 */
export async function refreshSeededSchemes(logger: Logger): Promise<SeededSchemeRefreshSummary> {
  const summary: SeededSchemeRefreshSummary = { refreshed: 0, unchanged: 0, failed: 0, skipped: 0, criteriaSwept: 0 };

  const rows = await prisma.conformityScheme.findMany({
    where: { tenantId: SYSTEM_TENANT_ID, source: ConformitySchemeSource.SYSTEM_SEED },
    select: { id: true, sourceUrl: true, specVersion: true, seedEntryKind: true },
  });

  for (const row of rows) {
    const refreshable =
      row.seedEntryKind === SeedEntryKind.URL || (row.seedEntryKind === null && /^https?:\/\//.test(row.sourceUrl));
    if (!refreshable) {
      summary.skipped += 1;
      continue;
    }

    try {
      const dataModel = await prisma.dataModel.findFirst({
        where: {
          tenantId: SYSTEM_TENANT_ID,
          credentialType: 'ConformityScheme',
          version: row.specVersion,
          isExtension: false,
        },
      });
      if (!dataModel) {
        logger.error(
          { sourceUrl: row.sourceUrl, specVersion: row.specVersion },
          'No ConformityScheme data-model binding for this spec version; skipping row',
        );
        summary.failed += 1;
        continue;
      }

      const result = await ingestConformityScheme({
        sourceUrl: row.sourceUrl,
        source: ConformitySchemeSource.SYSTEM_SEED,
        tenantId: SYSTEM_TENANT_ID,
        conformitySchemaUrl: dataModel.schemaUrl,
        schemaLoader,
        conformityVocabularySpecVersion: row.specVersion,
        requireExistingRow: true,
      });

      if (result.kind === 'stale') {
        // The row was evicted or replaced by another writer after this pass
        // listed it; membership belongs to the seed loader, so drop it.
        logger.info({ sourceUrl: row.sourceUrl }, 'Seeded conformity scheme row changed mid-refresh; leaving it');
        summary.skipped += 1;
        continue;
      }
      if (result.kind === 'success') {
        logger.info({ sourceUrl: row.sourceUrl }, 'Seeded conformity scheme refreshed from source');
        summary.refreshed += 1;
      } else if (result.kind === 'unchanged') {
        summary.unchanged += 1;
      } else {
        logger.error(
          { sourceUrl: row.sourceUrl, status: result.error.status, message: result.error.message },
          'Seeded conformity scheme refresh failed; previous content retained',
        );
        summary.failed += 1;
      }
    } catch (err) {
      logger.error(
        { sourceUrl: row.sourceUrl, err: err instanceof Error ? err.message : err },
        'Unexpected error refreshing seeded conformity scheme; continuing with the next row',
      );
      summary.failed += 1;
    }
  }

  try {
    summary.criteriaSwept = await prisma.$transaction(async (tx) => {
      await acquireCvcStructuralLock(tx, SYSTEM_TENANT_ID);
      const result = await tx.conformityCriterion.deleteMany({
        where: { tenantId: SYSTEM_TENANT_ID, profiles: { none: {} } },
      });
      return result.count;
    });
  } catch (err) {
    // Only the anticipated conflict is tolerable: the join FK's Restrict
    // firing because a concurrent writer re-referenced a criterion mid-sweep
    // (Prisma P2003). That defers the sweep to the next cadence with the
    // refresh results standing. Anything else (connection loss, lock
    // failure, schema drift) rethrows so the pass fails loudly.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      logger.warn({ err: err.message }, 'Orphan-criterion sweep deferred to the next refresh tick (concurrent writer)');
    } else {
      throw err;
    }
  }

  return summary;
}
