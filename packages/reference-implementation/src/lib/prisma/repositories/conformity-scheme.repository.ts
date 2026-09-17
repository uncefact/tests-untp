import type {
  ConformityScheme,
  ConformityProfile,
  ConformityCriterion,
  ConformityTopic,
  ConformitySchemeOwner,
  ConformityReferenceMatch,
} from '@uncefact/untp-utils/conformity-vocabulary';
import { ConformitySchemeParseError, parseConformityScheme } from '@uncefact/untp-utils/conformity-vocabulary';
import type {
  ConformitySchemeSummary,
  ConformityProfileSummary,
  ConformityCriterionSummary,
} from './conformity-scheme.schemas';
import { Prisma } from '../generated';
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';
import { appLogger } from '@/lib/api/logger';
import { createHash } from 'node:crypto';

const logger = appLogger.child({ module: 'conformity-scheme.repository' });
const MAX_UNREADABLE_DOCUMENT_LOG_KEYS = 256;
const loggedUnreadableDocumentKeys = new Set<string>();

/**
 * Prisma include shape that pulls a scheme's full profile -> criterion graph
 * in one query, so the projection is built without per-row fetches.
 */
const SCHEME_GRAPH_INCLUDE = {
  profiles: { include: { criteria: { include: { criterion: true } } } },
} as const;

type ConformitySchemeReadClient = Pick<Prisma.TransactionClient, 'conformityScheme'>;
type SchemeRow = Awaited<ReturnType<typeof loadRows>>[number];
type ProfileRow = SchemeRow['profiles'][number];
type CriterionRow = ProfileRow['criteria'][number]['criterion'];

/**
 * Whether score projection was available, unavailable or not requested.
 * Frameworks are absent, not empty, when evidence is unavailable or not
 * requested.
 */
export type ConformityScoringEvidence =
  | 'available'
  | 'missing-raw-document'
  | 'unparseable-raw-document'
  | 'not-requested';

/**
 * A catalogue graph plus the evidence state for any requested score
 * projection. Frameworks are absent, not empty, when evidence is unavailable
 * or not requested.
 */
export interface ConformitySchemeLookup {
  scheme: ConformityScheme;
  scoringEvidence: ConformityScoringEvidence;
}

function loadRows(client: ConformitySchemeReadClient, canonicalId: string, tenantId: string) {
  return client.conformityScheme.findMany({
    where: { canonicalId, tenantId: { in: [SYSTEM_TENANT_ID, tenantId] } },
    include: SCHEME_GRAPH_INCLUDE,
  });
}

function toTopics(value: unknown): ConformityTopic[] {
  return Array.isArray(value) ? (value as ConformityTopic[]) : [];
}

function toCriterion(row: CriterionRow): ConformityCriterion {
  return {
    canonicalId: row.canonicalId,
    name: row.name,
    version: row.version,
    status: row.status,
    ...(row.description != null && { description: row.description }),
    ...(row.documentation != null && { documentation: row.documentation }),
    topics: toTopics(row.topics),
    tags: Array.isArray(row.tags) ? row.tags : [],
  };
}

function toProfile(row: ProfileRow): ConformityProfile {
  return {
    canonicalId: row.canonicalId,
    name: row.name,
    version: row.version,
    status: row.status,
    ...(row.description != null && { description: row.description }),
    ...(row.documentation != null && { documentation: row.documentation }),
    ...(row.validFrom != null && { validFrom: row.validFrom }),
    criteria: row.criteria.filter((pc) => pc.criterion != null).map((pc) => toCriterion(pc.criterion)),
  };
}

/** Projects the two nullable owner columns into the optional owner object, or `undefined` when neither is set. */
function toOwner(ownerCanonicalId: string | null, ownerName: string | null): ConformitySchemeOwner | undefined {
  if (ownerCanonicalId == null && ownerName == null) return undefined;
  return {
    ...(ownerCanonicalId != null && { canonicalId: ownerCanonicalId }),
    ...(ownerName != null && { name: ownerName }),
  };
}

function rememberUnreadableDocument(
  rowId: string,
  specVersion: string,
  failureClass: string,
  rawDocument: unknown,
): boolean {
  const bodyDigest = createHash('sha256')
    .update(JSON.stringify(rawDocument) ?? String(rawDocument))
    .digest('hex');
  const key = `${rowId}|${specVersion}|${failureClass}|${bodyDigest}`;
  if (loggedUnreadableDocumentKeys.has(key)) return false;
  if (loggedUnreadableDocumentKeys.size >= MAX_UNREADABLE_DOCUMENT_LOG_KEYS) {
    const oldestKey = loggedUnreadableDocumentKeys.values().next().value;
    if (oldestKey !== undefined) loggedUnreadableDocumentKeys.delete(oldestKey);
  }
  loggedUnreadableDocumentKeys.add(key);
  return true;
}

function toScheme(row: SchemeRow, projectScores: boolean): ConformitySchemeLookup {
  const owner = toOwner(row.ownerCanonicalId, row.ownerName);
  const scheme: ConformityScheme = {
    canonicalId: row.canonicalId,
    sourceUrl: row.sourceUrl,
    specVersion: row.specVersion,
    name: row.name,
    ...(row.description != null && { description: row.description }),
    ...(row.documentation != null && { documentation: row.documentation }),
    ...(owner && { owner }),
    profiles: row.profiles.map(toProfile),
  };

  if (!projectScores) {
    return { scheme, scoringEvidence: 'not-requested' };
  }

  if (row.rawDocument == null) {
    logger.info(
      { canonicalId: row.canonicalId, sourceUrl: row.sourceUrl },
      'Stored conformity scheme document is missing for score projection',
    );
    return { scheme, scoringEvidence: 'missing-raw-document' };
  }

  let parsed: ConformityScheme;
  try {
    parsed = parseConformityScheme(row.rawDocument, {
      sourceUrl: row.sourceUrl,
      specVersion: row.specVersion,
    });
  } catch (error) {
    const failurePointers =
      error instanceof ConformitySchemeParseError
        ? error.failures.map((failure) => failure.pointer).filter((pointer): pointer is string => pointer !== undefined)
        : [];
    const failureClass = error instanceof Error ? error.name : typeof error;
    const logContext = {
      err: error,
      id: row.id,
      tenantId: row.tenantId,
      specVersion: row.specVersion,
      canonicalId: row.canonicalId,
      sourceUrl: row.sourceUrl,
      failurePointers,
    };
    if (!rememberUnreadableDocument(row.id, row.specVersion, failureClass, row.rawDocument)) {
      logger.debug(logContext, 'Stored conformity scheme document could not be read for score projection');
    } else if (error instanceof ConformitySchemeParseError) {
      logger.warn(logContext, 'Stored conformity scheme document could not be read for score projection');
    } else {
      logger.error(logContext, 'Stored conformity scheme document could not be read for score projection');
    }
    return { scheme, scoringEvidence: 'unparseable-raw-document' };
  }

  const profilesById = new Map(parsed.profiles.map((profile) => [profile.canonicalId, profile]));
  return {
    scheme: {
      ...scheme,
      ...(parsed.scoringFramework && { scoringFramework: parsed.scoringFramework }),
      profiles: scheme.profiles.map((profile) => {
        const parsedProfile = profilesById.get(profile.canonicalId);
        if (!parsedProfile) return profile;
        const criteriaById = new Map(parsedProfile.criteria.map((criterion) => [criterion.canonicalId, criterion]));
        return {
          ...profile,
          ...(parsedProfile.criterionScoringFrameworks !== undefined && {
            criterionScoringFrameworks: parsedProfile.criterionScoringFrameworks,
          }),
          criteria: profile.criteria.map((criterion) => {
            const parsedCriterion = criteriaById.get(criterion.canonicalId);
            return parsedCriterion?.requiredPerformance !== undefined
              ? { ...criterion, requiredPerformance: parsedCriterion.requiredPerformance }
              : criterion;
          }),
        };
      }),
    },
    scoringEvidence: 'available',
  };
}

/**
 * Loads a conformity scheme by its canonical URI as a
 * {@link ConformitySchemeLookup}: the graph projected into the
 * `@uncefact/untp-utils` {@link ConformityScheme} shape that
 * `validateConformityClaim` consumes, and the evidence state of the score
 * projection. Callers pass `lookup.scheme` to the validator. Profiles and their
 * criteria (with topics) are included.
 *
 * When score projection is requested, the scoring frameworks are parsed out of
 * the row's stored raw document and overlaid on the graph at read time, matched
 * by profile and criterion canonical id inside that document. The parse is
 * guarded, so a missing or defective stored document still yields the graph and
 * reports itself through `scoringEvidence` instead of failing the lookup.
 *
 * Visibility follows ADR-033: a system-tenant row (UNTP-discovered or
 * system-seeded) takes precedence over a tenant-imported row for the same
 * canonical URI, so the system row is checked first and the caller's tenant row
 * is used only as a fallback.
 *
 * The graph and stored document are read in one repeatable-read snapshot so a
 * catalogue refresh cannot produce a mixed graph and scoring projection. Pure
 * projection runs after the transaction returns, so parsing does not hold the
 * database connection.
 *
 * @param canonicalId - The scheme's canonical URI (no version segment).
 * @param tenantId - The calling tenant.
 * @param options - `projectScores` (default `true`) overlays the stored
 *   document's scoring frameworks; pass `false` for a claim with no score to
 *   skip the parse, which yields `scoringEvidence: 'not-requested'`.
 * @returns The lookup, or `null` when no row exists in either lane. Frameworks
 * are absent, not empty, when score projection is unavailable or not requested.
 */
export async function findConformitySchemeByCanonicalId(
  canonicalId: string,
  tenantId: string,
  options: { projectScores?: boolean } = {},
): Promise<ConformitySchemeLookup | null> {
  const projectScores = options.projectScores ?? true;
  const row = await prisma.$transaction(
    async (tx) => {
      const rows = await loadRows(tx, canonicalId, tenantId);
      // A system-tenant row supersedes a tenant-imported row for the same URI.
      return rows.find((r) => r.tenantId === SYSTEM_TENANT_ID) ?? rows[0] ?? null;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
  return row ? toScheme(row, projectScores) : null;
}

function preferSystemRows<T extends { canonicalId: string; tenantId: string }>(rows: readonly T[]): T[] {
  const byCanonicalId = new Map<string, T>();
  for (const row of rows) {
    const existing = byCanonicalId.get(row.canonicalId);
    if (!existing || (row.tenantId === SYSTEM_TENANT_ID && existing.tenantId !== SYSTEM_TENANT_ID)) {
      byCanonicalId.set(row.canonicalId, row);
    }
  }
  return [...byCanonicalId.values()];
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * Resolves submitted scheme and profile ids across catalogue tiers without
 * changing the selected scheme graph. The result is intentionally diagnostic
 * only: the validator decides whether a match is a wrong-tier warning.
 */
export async function resolveConformityReferences(
  uris: string[],
  tenantId: string,
): Promise<Map<string, ConformityReferenceMatch[]>> {
  const requestedUris = [...new Set(uris)];
  if (requestedUris.length === 0) return new Map();
  const visibleTenants = [SYSTEM_TENANT_ID, tenantId];

  const [schemeRows, profileRows, criterionRows] = await Promise.all([
    prisma.conformityScheme.findMany({
      where: { canonicalId: { in: requestedUris }, tenantId: { in: visibleTenants } },
      select: { canonicalId: true, tenantId: true },
      orderBy: { canonicalId: 'asc' },
    }),
    prisma.conformityProfile.findMany({
      where: { canonicalId: { in: requestedUris }, tenantId: { in: visibleTenants } },
      select: {
        canonicalId: true,
        tenantId: true,
        scheme: { select: { canonicalId: true, tenantId: true } },
      },
      orderBy: { canonicalId: 'asc' },
    }),
    prisma.conformityCriterion.findMany({
      where: { canonicalId: { in: requestedUris }, tenantId: { in: visibleTenants } },
      select: {
        canonicalId: true,
        tenantId: true,
        profiles: {
          where: { profile: { tenantId: { in: visibleTenants } } },
          select: {
            profile: {
              select: {
                canonicalId: true,
                tenantId: true,
                scheme: { select: { canonicalId: true, tenantId: true } },
              },
            },
          },
        },
      },
      orderBy: { canonicalId: 'asc' },
    }),
  ]);

  const resolved = new Map<string, ConformityReferenceMatch[]>();
  requestedUris.forEach((uri) => resolved.set(uri, []));

  for (const row of preferSystemRows(schemeRows)) {
    resolved.get(row.canonicalId)?.push({ tier: 'scheme', schemes: [row.canonicalId] });
  }

  for (const row of preferSystemRows(profileRows)) {
    resolved.get(row.canonicalId)?.push({ tier: 'profile', schemes: [row.scheme.canonicalId] });
  }

  for (const row of preferSystemRows(criterionRows)) {
    const profiles = preferSystemRows(row.profiles.map((profileCriterion) => profileCriterion.profile));
    if (profiles.length === 0) continue;
    resolved.get(row.canonicalId)?.push({
      tier: 'criterion',
      schemes: uniqueSorted(profiles.map((profile) => profile.scheme.canonicalId)),
      profiles: uniqueSorted(profiles.map((profile) => profile.canonicalId)),
    });
  }

  return resolved;
}

// The issuer-facing browse projection shapes live in conformity-scheme.schemas.ts
// (a Prisma-free module the Swagger generator also imports); re-exported here so
// repository consumers keep a single import site.
export {
  conformitySchemeSummarySchema,
  conformityProfileSummarySchema,
  conformityCriterionSummarySchema,
} from './conformity-scheme.schemas';
export type {
  ConformitySchemeSummary,
  ConformityProfileSummary,
  ConformityCriterionSummary,
} from './conformity-scheme.schemas';

/**
 * Lists the conformity schemes visible to a tenant for issuer browsing: the
 * system-tenant catalogue (UNTP-discovered and operator-seeded) plus the
 * tenant's own imports. Where a canonical URI exists in both lanes the
 * system-tenant row wins (ADR-033 §2, "URI uniqueness and conflict
 * resolution"), so a tenant never sees a private overlay of a registered
 * scheme. Sorted by name.
 *
 * @param tenantId - The calling tenant.
 */
export async function listConformitySchemes(tenantId: string): Promise<ConformitySchemeSummary[]> {
  const rows = await prisma.conformityScheme.findMany({
    where: { tenantId: { in: [SYSTEM_TENANT_ID, tenantId] } },
    select: {
      canonicalId: true,
      name: true,
      specVersion: true,
      ownerCanonicalId: true,
      ownerName: true,
      tenantId: true,
    },
  });

  return preferSystemRows(rows)
    .map((row) => {
      const owner = toOwner(row.ownerCanonicalId, row.ownerName);
      return {
        id: row.canonicalId,
        name: row.name,
        specVersion: row.specVersion,
        ...(owner && { owner }),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Lists the profiles a scheme publishes, for an issuer who has chosen a scheme.
 * The scheme is resolved by canonical URI with the same system-row precedence as
 * {@link findConformitySchemeByCanonicalId}; an unknown scheme yields an empty
 * list. Sorted by name.
 *
 * @param schemeCanonicalId - The chosen scheme's canonical URI.
 * @param tenantId - The calling tenant.
 */
export async function listConformityProfiles(
  schemeCanonicalId: string,
  tenantId: string,
): Promise<ConformityProfileSummary[]> {
  const schemes = await prisma.conformityScheme.findMany({
    where: { canonicalId: schemeCanonicalId, tenantId: { in: [SYSTEM_TENANT_ID, tenantId] } },
    include: { profiles: true },
  });
  const scheme = schemes.find((s) => s.tenantId === SYSTEM_TENANT_ID) ?? schemes[0];
  if (!scheme) {
    return [];
  }
  return scheme.profiles
    .map((p) => ({
      id: p.canonicalId,
      name: p.name,
      version: p.version,
      status: p.status,
      ...(p.validFrom != null && { validFrom: p.validFrom }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Lists the criteria a profile references, for an issuer who has chosen a
 * profile. The profile is resolved by canonical URI with system-row precedence;
 * an unknown profile yields an empty list. Sorted by name.
 *
 * @param profileCanonicalId - The chosen profile's canonical URI.
 * @param tenantId - The calling tenant.
 */
export async function listConformityCriteria(
  profileCanonicalId: string,
  tenantId: string,
): Promise<ConformityCriterionSummary[]> {
  const profiles = await prisma.conformityProfile.findMany({
    where: { canonicalId: profileCanonicalId, tenantId: { in: [SYSTEM_TENANT_ID, tenantId] } },
    include: { criteria: { include: { criterion: true } } },
  });
  const profile = profiles.find((p) => p.tenantId === SYSTEM_TENANT_ID) ?? profiles[0];
  if (!profile) {
    return [];
  }
  return profile.criteria
    .filter((pc) => pc.criterion != null)
    .map((pc) => ({
      id: pc.criterion.canonicalId,
      name: pc.criterion.name,
      version: pc.criterion.version,
      status: pc.criterion.status,
      topics: toTopics(pc.criterion.topics),
      tags: Array.isArray(pc.criterion.tags) ? pc.criterion.tags : [],
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
