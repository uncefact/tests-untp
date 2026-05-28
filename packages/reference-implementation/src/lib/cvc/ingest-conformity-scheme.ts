import {
  resolveAndParseConformityScheme,
  type ConformitySchemeResolveError,
  type PrefetchedDocument,
} from '@uncefact/untp-ri-services/cvc';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import type { SchemaLoader } from '@uncefact/untp-utils/schema-loaders';
import type {
  ConformityCriterion as ParsedCriterion,
  ConformityScheme as ParsedScheme,
} from '@uncefact/untp-utils/conformity-vocabulary';
import { ConformityFetchStatus, ConformitySchemeSource, Prisma } from '@/lib/prisma/generated';
import { prisma } from '@/lib/prisma/prisma';

export interface IngestConformitySchemeInput {
  sourceUrl: string;
  source: ConformitySchemeSource;
  tenantId: string;
  conformitySchemaUrl: string;
  schemaLoader: SchemaLoader;
  prefetched?: PrefetchedDocument;
  conformityVocabularySpecVersion?: string;
}

export type IngestConformitySchemeResult =
  | { kind: 'unchanged'; schemeId: string }
  | { kind: 'success'; schemeId: string }
  | { kind: 'failure'; schemeId?: string; error: ConformitySchemeResolveError };

/**
 * Resolves a conformity scheme and persists the result. Composes the
 * services-level `resolveAndParseConformityScheme` with the RI's `ConformityScheme`
 * (and child) tables, mapping each outcome onto a Prisma write.
 *
 * Outcomes mirror ADR-033 §1's partial-failure semantics:
 * `unchanged`: previous content retained; only `lastFetchedAt` is bumped.
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
  });

  const now = new Date();

  if (result.kind === 'unchanged') {
    if (!existing) {
      throw new Error('resolveAndParseConformityScheme reported unchanged with no existing row');
    }
    await prisma.conformityScheme.update({
      where: { id: existing.id },
      data: { lastFetchedAt: now },
    });
    return { kind: 'unchanged', schemeId: existing.id };
  }

  if (result.kind === 'failure') {
    if (!existing) {
      return { kind: 'failure', error: result.error };
    }
    await prisma.conformityScheme.update({
      where: { id: existing.id },
      data: { lastFetchedAt: now, lastFetchStatus: result.error.status as ConformityFetchStatus },
    });
    return { kind: 'failure', schemeId: existing.id, error: result.error };
  }

  return persistSuccess({
    existingId: existing?.id,
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
    lastFetchStatus: ConformityFetchStatus.SUCCESS,
    rawDocument: raw as Prisma.InputJsonValue,
    tenantId: input.tenantId,
  };

  const schemeId = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
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

    return row.id;
  });

  return { kind: 'success', schemeId };
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
