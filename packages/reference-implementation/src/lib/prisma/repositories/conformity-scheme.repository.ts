import type {
  ConformityScheme,
  ConformityProfile,
  ConformityCriterion,
  ConformityTopic,
} from '@uncefact/untp-utils/conformity-vocabulary';
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';

/**
 * Prisma include shape that pulls a scheme's full profile -> criterion graph
 * in one query, so the projection is built without per-row fetches.
 */
const SCHEME_GRAPH_INCLUDE = {
  profiles: { include: { criteria: { include: { criterion: true } } } },
} as const;

type SchemeRow = Awaited<ReturnType<typeof loadRows>>[number];
type ProfileRow = SchemeRow['profiles'][number];
type CriterionRow = ProfileRow['criteria'][number]['criterion'];

function loadRows(canonicalId: string, tenantId: string) {
  return prisma.conformityScheme.findMany({
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

function toScheme(row: SchemeRow): ConformityScheme {
  return {
    canonicalId: row.canonicalId,
    sourceUrl: row.sourceUrl,
    specVersion: row.specVersion,
    name: row.name,
    ...(row.description != null && { description: row.description }),
    ...(row.documentation != null && { documentation: row.documentation }),
    ...((row.ownerCanonicalId != null || row.ownerName != null) && {
      owner: {
        ...(row.ownerCanonicalId != null && { canonicalId: row.ownerCanonicalId }),
        ...(row.ownerName != null && { name: row.ownerName }),
      },
    }),
    profiles: row.profiles.map(toProfile),
  };
}

/**
 * Loads a conformity scheme by its canonical URI, projected into the
 * `@uncefact/untp-utils` {@link ConformityScheme} shape that
 * `validateConformityClaim` consumes. Profiles and their criteria (with topics)
 * are included.
 *
 * Visibility follows ADR-033: a system-tenant row (UNTP-discovered or
 * system-seeded) takes precedence over a tenant-imported row for the same
 * canonical URI, so the system row is checked first and the caller's tenant row
 * is used only as a fallback.
 *
 * @param canonicalId - The scheme's canonical URI (no version segment).
 * @param tenantId - The calling tenant.
 * @returns The projected scheme, or `null` when no row exists in either lane.
 */
export async function findConformitySchemeByCanonicalId(
  canonicalId: string,
  tenantId: string,
): Promise<ConformityScheme | null> {
  const rows = await loadRows(canonicalId, tenantId);
  // A system-tenant row supersedes a tenant-imported row for the same URI.
  const row = rows.find((r) => r.tenantId === SYSTEM_TENANT_ID) ?? rows[0] ?? null;
  return row ? toScheme(row) : null;
}
