import {
  resolveAndParseConformityScheme,
  type ConformitySchemeResolveError,
  type PrefetchedDocument,
} from '@uncefact/untp-ri-services/cvc';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import type { SchemaLoader } from '@uncefact/untp-utils/loaders';
import type {
  ConformityCriterion as ParsedCriterion,
  ConformityScheme as ParsedScheme,
} from '@uncefact/untp-utils/conformity-vocabulary';
import { ConformityFetchStatus, ConformitySchemeSource, Prisma, SeedEntryKind } from '../prisma/generated';
import { prisma } from '../prisma/prisma';
import { contextCache } from '../credentials/context-cache';
import { acquireCvcStructuralLock } from './cvc-structural-lock';

export interface IngestConformitySchemeInput {
  sourceUrl: string;
  source: ConformitySchemeSource;
  tenantId: string;
  conformitySchemaUrl: string;
  schemaLoader: SchemaLoader;
  prefetched?: PrefetchedDocument;
  conformityVocabularySpecVersion?: string;
  /**
   * Seed-manifest provenance for SYSTEM_SEED rows (URL vs FILE entry),
   * persisted so the periodic refresh knows which rows it may re-fetch.
   * Written on every outcome that touches the row (success, unchanged, and
   * recorded failure), so a pre-existing row converges on its first boot
   * even when its content has not changed. Omit outside the seed loader; an
   * omitted value leaves the stored one.
   */
  seedEntryKind?: SeedEntryKind;
  /**
   * When true, the persist never creates a row: after taking the structural
   * lock it re-reads the row and returns `stale` if the row has been evicted
   * (a timer must never recreate membership the manifest removed) or if
   * another writer replaced the content this resolution was based on (an
   * older fetch must never overwrite a newer one). Set by the periodic
   * refresh; the seed loader owns membership and leaves this unset.
   */
  requireExistingRow?: boolean;
}

export type IngestConformitySchemeResult =
  | { kind: 'unchanged'; schemeId: string }
  | { kind: 'success'; schemeId: string }
  | { kind: 'stale'; schemeId?: string }
  | { kind: 'failure'; schemeId?: string; error: ConformitySchemeResolveError };

/**
 * Resolves a conformity scheme and persists the result. Composes the
 * services-level `resolveAndParseConformityScheme` with the RI's `ConformityScheme`
 * (and child) tables, mapping each outcome onto a Prisma write.
 *
 * Outcomes mirror ADR-033 §1's partial-failure semantics:
 * `unchanged`: previous content retained; `lastFetchedAt` and
 *   `lastSuccessAt` are bumped (an unchanged poll counts as a successful
 *   poll for the stale-failure eviction policy in {@link runUntpDiscovery}).
 * `success`: full upsert of the scheme + profiles + criteria + join rows;
 *   stale profiles owned by this scheme are deleted to keep the persisted
 *   content in step with the resolved document.
 * `failure`: persisted as `lastFetchStatus = error.status`, retaining
 *   previously-successful content. If no row exists yet (first-time
 *   failure) nothing is written; the caller is expected to surface the
 *   failure through logs / the trigger's response (the table only holds
 *   schemes for which we have at least one parsed document).
 *
 * @see ADR-033 §1 (Discovery and refresh; Partial-failure behaviour).
 */
export async function ingestConformityScheme(
  input: IngestConformitySchemeInput,
): Promise<IngestConformitySchemeResult> {
  const existing = await prisma.conformityScheme.findUnique({
    where: { sourceUrl_tenantId: { sourceUrl: input.sourceUrl, tenantId: input.tenantId } },
    select: { id: true, etag: true, lastModifiedHeader: true, bodyDigest: true },
  });

  const cached = existing
    ? {
        etag: existing.etag ?? undefined,
        lastModifiedHeader: existing.lastModifiedHeader ?? undefined,
        bodyDigest: existing.bodyDigest ? MultibaseDigest.fromString(existing.bodyDigest) : undefined,
      }
    : undefined;

  const result = await resolveAndParseConformityScheme({
    sourceUrl: input.sourceUrl,
    source: input.source,
    tenantId: input.tenantId,
    conformitySchemaUrl: input.conformitySchemaUrl,
    schemaLoader: input.schemaLoader,
    prefetched: input.prefetched,
    cached,
    conformityVocabularySpecVersion: input.conformityVocabularySpecVersion,
    // Shared with the issuance path (uncefact/tests-untp#891): a pass over
    // many schemes fetches each remote @context once per TTL, not per scheme.
    contextCache,
  });

  const now = new Date();

  // Convergence data written on every row-touching outcome: an unchanged
  // poll is a successful poll (status included, so a prior failure clears
  // once the source is reachable again), and the seed-entry marker converges
  // pre-existing rows even when their content never changes.
  const convergence = input.seedEntryKind !== undefined ? { seedEntryKind: input.seedEntryKind } : {};

  if (result.kind === 'unchanged') {
    await prisma.conformityScheme.update({
      where: { id: existing!.id },
      data: { lastFetchedAt: now, lastSuccessAt: now, lastFetchStatus: ConformityFetchStatus.SUCCESS, ...convergence },
    });
    return { kind: 'unchanged', schemeId: existing!.id };
  }

  if (result.kind === 'failure') {
    if (!existing) {
      return { kind: 'failure', error: result.error };
    }
    await prisma.conformityScheme.update({
      where: { id: existing.id },
      data: { lastFetchedAt: now, lastFetchStatus: result.error.status as ConformityFetchStatus, ...convergence },
    });
    return { kind: 'failure', schemeId: existing.id, error: result.error };
  }

  return persistSuccess({
    existingId: existing?.id,
    baselineBodyDigest: existing?.bodyDigest ?? null,
    requireExistingRow: input.requireExistingRow === true,
    scheme: result.scheme,
    raw: result.raw,
    bodyDigestEncoded: result.bodyDigest.toString(),
    etag: result.etag,
    lastModifiedHeader: result.lastModifiedHeader,
    input,
    now,
  });
}

interface PersistSuccessArgs {
  existingId?: string;
  /** The stored digest this resolution was fetched against, for the staleness compare. */
  baselineBodyDigest: string | null;
  requireExistingRow: boolean;
  scheme: ParsedScheme;
  raw: unknown;
  bodyDigestEncoded: string;
  etag?: string;
  lastModifiedHeader?: string;
  input: IngestConformitySchemeInput;
  now: Date;
}

async function persistSuccess(args: PersistSuccessArgs): Promise<IngestConformitySchemeResult> {
  const { existingId, scheme, raw, bodyDigestEncoded, etag, lastModifiedHeader, input, now } = args;

  const schemeData = {
    canonicalId: scheme.canonicalId,
    name: scheme.name,
    description: scheme.description ?? null,
    documentation: scheme.documentation ?? null,
    ownerCanonicalId: scheme.owner?.canonicalId ?? null,
    ownerName: scheme.owner?.name ?? null,
    specVersion: scheme.specVersion,
    source: input.source,
    sourceUrl: input.sourceUrl,
    etag: etag ?? null,
    lastModifiedHeader: lastModifiedHeader ?? null,
    bodyDigest: bodyDigestEncoded,
    lastFetchedAt: now,
    lastSuccessAt: now,
    lastFetchStatus: ConformityFetchStatus.SUCCESS,
    ...(input.seedEntryKind !== undefined ? { seedEntryKind: input.seedEntryKind } : {}),
    rawDocument: raw as Prisma.InputJsonValue,
    tenantId: input.tenantId,
  };

  const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Serialise against the other CVC structural writers (eviction, orphan
    // sweep, other refresh ticks) so the sweep's no-joins predicate and this
    // delete-and-recreate of profiles cannot interleave.
    await acquireCvcStructuralLock(tx, input.tenantId);

    // Existing-only callers (the periodic refresh) validate their pre-lock
    // decision now that the lock is held: the row must still exist (an
    // evicted scheme is never recreated by a timer) and must still carry the
    // digest this resolution fetched against (an older fetch never
    // overwrites a newer writer's content).
    if (args.requireExistingRow) {
      const current = await tx.conformityScheme.findUnique({
        where: { sourceUrl_tenantId: { sourceUrl: input.sourceUrl, tenantId: input.tenantId } },
        select: { id: true, bodyDigest: true },
      });
      if (!current || current.bodyDigest !== args.baselineBodyDigest) {
        return { stale: true as const };
      }
    }
    let row: { id: string };
    if (existingId) {
      await tx.conformityProfile.deleteMany({ where: { schemeId: existingId } });
      row = await tx.conformityScheme.update({
        where: { id: existingId },
        data: schemeData,
        select: { id: true },
      });
    } else {
      row = await tx.conformityScheme.create({ data: schemeData, select: { id: true } });
    }

    const uniqueCriteria = new Map<string, ParsedCriterion>();
    for (const profile of scheme.profiles) {
      for (const criterion of profile.criteria) {
        uniqueCriteria.set(criterion.canonicalId, criterion);
      }
    }

    const criterionRowIds = new Map<string, string>();
    for (const criterion of uniqueCriteria.values()) {
      const upserted = await tx.conformityCriterion.upsert({
        where: {
          canonicalId_tenantId: { canonicalId: criterion.canonicalId, tenantId: input.tenantId },
        },
        update: criterionWriteData(criterion),
        create: { ...criterionWriteData(criterion), canonicalId: criterion.canonicalId, tenantId: input.tenantId },
        select: { id: true },
      });
      criterionRowIds.set(criterion.canonicalId, upserted.id);
    }

    for (const profile of scheme.profiles) {
      const profileRow = await tx.conformityProfile.create({
        data: {
          canonicalId: profile.canonicalId,
          name: profile.name,
          version: profile.version,
          status: profile.status,
          description: profile.description ?? null,
          documentation: profile.documentation ?? null,
          validFrom: profile.validFrom ?? null,
          tenantId: input.tenantId,
          schemeId: row.id,
        },
        select: { id: true },
      });
      const seenCriterionIds = new Set<string>();
      for (const criterion of profile.criteria) {
        if (seenCriterionIds.has(criterion.canonicalId)) continue;
        seenCriterionIds.add(criterion.canonicalId);
        const criterionId = criterionRowIds.get(criterion.canonicalId);
        if (!criterionId) throw new Error(`criterion ${criterion.canonicalId} not upserted before profile join`);
        await tx.conformityProfileCriterion.create({
          data: { profileId: profileRow.id, criterionId },
        });
      }
    }

    return { stale: false as const, schemeId: row.id };
  });

  if (outcome.stale) {
    return { kind: 'stale' };
  }
  return { kind: 'success', schemeId: outcome.schemeId };
}

function criterionWriteData(criterion: ParsedCriterion) {
  return {
    name: criterion.name,
    version: criterion.version,
    status: criterion.status,
    description: criterion.description ?? null,
    documentation: criterion.documentation ?? null,
    topics: criterion.topics as unknown as Prisma.InputJsonValue,
    tags: criterion.tags,
  };
}
