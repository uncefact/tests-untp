import { parseConformityCatalogue } from '@uncefact/untp-utils/conformity-vocabulary';
import type { SchemaLoader } from '@uncefact/untp-utils/schema-loaders';
import { ConformityFetchStatus, ConformitySchemeSource } from '@/lib/prisma/generated';
import { prisma } from '@/lib/prisma/prisma';
import { ingestConformityScheme } from './ingest-conformity-scheme';

export interface RunUntpDiscoveryInput {
  tenantId: string;
  registerUrl: string;
  conformitySchemaUrl: string;
  schemaLoader: SchemaLoader;
  conformityVocabularySpecVersion?: string;
  /**
   * UNTP rows whose `lastFetchStatus` has not been `SUCCESS` and whose
   * `lastSuccessAt` is older than this threshold are evicted at the end of the
   * discovery pass. Defaults to 7 days.
   */
  staleFailureMs?: number;
  /** Inject for tests. Defaults to `globalThis.fetch`. */
  fetchRegister?: (url: string) => Promise<Response>;
}

export interface RunUntpDiscoveryResult {
  iterated: number;
  succeeded: number;
  unchanged: number;
  failed: number;
  evictedUnseen: number;
  evictedStaleFailures: number;
}

const DEFAULT_STALE_FAILURE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Runs one pass of the UNTP CVC discovery loop:
 * fetches the register, iterates each catalogue entry through
 * {@link ingestConformityScheme}, then runs two eviction passes to keep the
 * persisted set in step with the publisher-side state:
 *
 * - **Unseen eviction**: any UNTP-sourced row whose `sourceUrl` was not in the
 *   register this pass is deleted. Handles register removals and URL
 *   re-pointings (the old URL is dropped; the new URL is ingested as a fresh
 *   row in the same pass).
 * - **Stale-failure eviction**: any UNTP-sourced row whose `lastFetchStatus`
 *   is not `SUCCESS` and whose `lastSuccessAt` is older than `staleFailureMs`
 *   is deleted. Handles owner-side URLs that have been persistently
 *   unreachable.
 *
 * If the register parses to zero entries, the unseen eviction is skipped so a
 * transient empty register can't nuke the local mirror. Tenant-imported and
 * seed-loaded rows are out of scope for both evictions.
 *
 * Throws if the register fetch itself fails (non-2xx response or transport
 * error); no eviction runs in that case.
 *
 * @see ADR-033 §1 (Discovery and refresh).
 */
export async function runUntpDiscovery(input: RunUntpDiscoveryInput): Promise<RunUntpDiscoveryResult> {
  const fetchRegister = input.fetchRegister ?? ((url) => fetch(url, { headers: { Accept: 'application/json' } }));
  const staleFailureMs = input.staleFailureMs ?? DEFAULT_STALE_FAILURE_MS;

  const response = await fetchRegister(input.registerUrl);
  if (!response.ok) {
    throw new Error(`UNTP CVC register fetch failed: ${response.status} ${response.statusText}`);
  }
  const doc = await response.json();
  const { entries } = parseConformityCatalogue(doc, { sourceUrl: input.registerUrl });

  const seenSourceUrls = new Set<string>();
  let succeeded = 0;
  let unchanged = 0;
  let failed = 0;

  for (const entry of entries) {
    seenSourceUrls.add(entry.vocabularyUrl);
    const result = await ingestConformityScheme({
      sourceUrl: entry.vocabularyUrl,
      source: ConformitySchemeSource.UNTP,
      tenantId: input.tenantId,
      conformitySchemaUrl: input.conformitySchemaUrl,
      schemaLoader: input.schemaLoader,
      conformityVocabularySpecVersion: input.conformityVocabularySpecVersion,
    });
    if (result.kind === 'success') succeeded += 1;
    else if (result.kind === 'unchanged') unchanged += 1;
    else failed += 1;
  }

  let evictedUnseen = 0;
  if (seenSourceUrls.size > 0) {
    const result = await prisma.conformityScheme.deleteMany({
      where: {
        tenantId: input.tenantId,
        source: ConformitySchemeSource.UNTP,
        sourceUrl: { notIn: [...seenSourceUrls] },
      },
    });
    evictedUnseen = result.count;
  }

  const staleCutoff = new Date(Date.now() - staleFailureMs);
  const evictedStaleFailures = await prisma.conformityScheme.deleteMany({
    where: {
      tenantId: input.tenantId,
      source: ConformitySchemeSource.UNTP,
      lastFetchStatus: { not: ConformityFetchStatus.SUCCESS },
      lastSuccessAt: { lt: staleCutoff },
    },
  });

  return {
    iterated: entries.length,
    succeeded,
    unchanged,
    failed,
    evictedUnseen,
    evictedStaleFailures: evictedStaleFailures.count,
  };
}
