import type {
  ConformityScheme,
  ConformityProfile,
  ConformityCriterion,
  ConformityTopic,
  ConformitySchemeOwner,
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

/** Projects the two nullable owner columns into the optional owner object, or `undefined` when neither is set. */
function toOwner(ownerCanonicalId: string | null, ownerName: string | null): ConformitySchemeOwner | undefined {
  if (ownerCanonicalId == null && ownerName == null) return undefined;
  return {
    ...(ownerCanonicalId != null && { canonicalId: ownerCanonicalId }),
    ...(ownerName != null && { name: ownerName }),
  };
}

function toScheme(row: SchemeRow): ConformityScheme {
  const owner = toOwner(row.ownerCanonicalId, row.ownerName);
  return {
    canonicalId: row.canonicalId,
    sourceUrl: row.sourceUrl,
    specVersion: row.specVersion,
    name: row.name,
    ...(row.description != null && { description: row.description }),
    ...(row.documentation != null && { documentation: row.documentation }),
    ...(owner && { owner }),
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

// ── Issuer-facing browse projections ───────────────────────────────────────────
// Flat, picker-friendly shapes that let an issuer drill scheme -> profile ->
// criterion and yield the canonical URIs a conformityClaim carries (profile and
// criterion URIs are versioned; the scheme URI is not).

/** A conformity scheme as listed in the browse API; `id` is the canonical URI. */
export interface ConformitySchemeSummary {
  id: string;
  name: string;
  specVersion: string;
  owner?: ConformitySchemeOwner;
}

/** A profile as listed under a scheme; `id` is the canonical (versioned) URI. */
export interface ConformityProfileSummary {
  id: string;
  name: string;
  version: string;
  status: string;
  validFrom?: string;
}

/** A criterion as listed under a profile; `id` is the canonical (versioned) URI. */
export interface ConformityCriterionSummary {
  id: string;
  name: string;
  version: string;
  status: string;
  topics: ConformityTopic[];
  tags: string[];
}

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

  const byCanonicalId = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const existing = byCanonicalId.get(row.canonicalId);
    if (!existing || (row.tenantId === SYSTEM_TENANT_ID && existing.tenantId !== SYSTEM_TENANT_ID)) {
      byCanonicalId.set(row.canonicalId, row);
    }
  }

  return [...byCanonicalId.values()]
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
