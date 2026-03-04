import { CvcCatalogue, ConformityScheme, ConformityProfile, Criterion, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { SYSTEM_TENANT_ID } from '@/lib/prisma/constants';

// ---------------------------------------------------------------------------
// Input / option / result types
// ---------------------------------------------------------------------------

export type ListResult<T> = { data: T[]; total: number };

export type ImportCatalogueInput = {
  tenantId: string;
  canonicalId: string;
  name: string;
  sourceUrl: string;
  specVersion: string;
  metadata?: Record<string, unknown>;
  schemes: {
    canonicalId: string;
    name: string;
    slug: string;
    description?: string;
    metadata?: Record<string, unknown>;
    profiles: {
      canonicalId: string;
      name: string;
      slug: string;
      version: string;
      status: string;
      description?: string;
      metadata?: Record<string, unknown>;
      criteria: {
        canonicalId: string;
        name: string;
        version: string;
        status: string;
        description?: string;
        conformityTopic?: string;
        passThreshold?: Record<string, unknown>;
        documentation?: string;
        metadata?: Record<string, unknown>;
      }[];
    }[];
  }[];
};

export type ImportCatalogueResult = {
  catalogue: CvcCatalogue;
  summary: { schemes: number; profiles: number; criteria: number };
};

export type ListOptions = {
  limit?: number;
  offset?: number;
};

export type ListSchemesOptions = ListOptions & { catalogueId?: string };
export type ListProfilesOptions = ListOptions & { schemeId?: string };
export type ListCriteriaOptions = ListOptions & { profileId?: string };

// ---------------------------------------------------------------------------
// importCatalogue
// ---------------------------------------------------------------------------

export async function importCatalogue(input: ImportCatalogueInput): Promise<ImportCatalogueResult> {
  const { tenantId, canonicalId, name, sourceUrl, specVersion, metadata, schemes } = input;

  return prisma.$transaction(
    async (tx) => {
      // Delete existing catalogue for the same canonicalId + tenantId
      await tx.cvcCatalogue.deleteMany({
        where: { canonicalId, tenantId },
      });

      // Clean orphan criteria for this tenant
      await tx.criterion.deleteMany({
        where: { tenantId, profiles: { none: {} } },
      });

      // Collect unique criteria across all profiles (dedupe by canonicalId)
      const uniqueCriteria = new Map<string, ImportCatalogueInput['schemes'][0]['profiles'][0]['criteria'][0]>();
      for (const scheme of schemes) {
        for (const profile of scheme.profiles) {
          for (const criterion of profile.criteria) {
            if (!uniqueCriteria.has(criterion.canonicalId)) {
              uniqueCriteria.set(criterion.canonicalId, criterion);
            }
          }
        }
      }

      // Upsert each criterion and collect IDs keyed by canonicalId
      const criterionIdMap = new Map<string, string>();
      for (const [cId, c] of uniqueCriteria) {
        const upserted = await tx.criterion.upsert({
          where: { canonicalId_tenantId: { canonicalId: cId, tenantId } },
          create: {
            canonicalId: cId,
            tenantId,
            name: c.name,
            version: c.version,
            status: c.status,
            description: c.description,
            conformityTopic: c.conformityTopic,
            passThreshold: c.passThreshold as Prisma.InputJsonValue | undefined,
            documentation: c.documentation,
            metadata: c.metadata as Prisma.InputJsonValue | undefined,
          },
          update: {
            name: c.name,
            version: c.version,
            status: c.status,
            description: c.description,
            conformityTopic: c.conformityTopic,
            passThreshold: c.passThreshold as Prisma.InputJsonValue | undefined,
            documentation: c.documentation,
            metadata: c.metadata as Prisma.InputJsonValue | undefined,
          },
        });
        criterionIdMap.set(cId, upserted.id);
      }

      // Track counts
      let profileCount = 0;

      // Create catalogue with nested schemes and profiles
      const catalogue = await tx.cvcCatalogue.create({
        data: {
          canonicalId,
          tenantId,
          name,
          sourceUrl,
          specVersion,
          metadata: metadata as Prisma.InputJsonValue | undefined,
          schemes: {
            create: schemes.map((scheme) => ({
              canonicalId: scheme.canonicalId,
              tenantId,
              name: scheme.name,
              slug: scheme.slug,
              description: scheme.description,
              metadata: scheme.metadata as Prisma.InputJsonValue | undefined,
              profiles: {
                create: scheme.profiles.map((profile) => {
                  profileCount++;
                  return {
                    canonicalId: profile.canonicalId,
                    tenantId,
                    name: profile.name,
                    slug: profile.slug,
                    version: profile.version,
                    status: profile.status,
                    description: profile.description,
                    metadata: profile.metadata as Prisma.InputJsonValue | undefined,
                  };
                }),
              },
            })),
          },
        },
        include: {
          schemes: {
            include: { profiles: true },
          },
        },
      });

      // Create ProfileCriterion join rows
      for (const scheme of catalogue.schemes) {
        for (const profile of scheme.profiles) {
          const inputScheme = schemes.find((s) => s.canonicalId === scheme.canonicalId)!;
          const inputProfile = inputScheme.profiles.find((p) => p.canonicalId === profile.canonicalId)!;

          if (inputProfile.criteria.length > 0) {
            await tx.profileCriterion.createMany({
              data: inputProfile.criteria.map((c) => ({
                profileId: profile.id,
                criterionId: criterionIdMap.get(c.canonicalId)!,
              })),
              skipDuplicates: true,
            });
          }
        }
      }

      return {
        catalogue,
        summary: {
          schemes: schemes.length,
          profiles: profileCount,
          criteria: uniqueCriteria.size,
        },
      };
    },
    { timeout: 30000 },
  );
}

// ---------------------------------------------------------------------------
// deleteCatalogue
// ---------------------------------------------------------------------------

export async function deleteCatalogue(id: string, tenantId: string): Promise<void> {
  const existing = await prisma.cvcCatalogue.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new NotFoundError('Catalogue not found or access denied');
  }

  await prisma.cvcCatalogue.delete({ where: { id } });

  // Clean orphan criteria for this tenant
  await prisma.criterion.deleteMany({
    where: { tenantId, profiles: { none: {} } },
  });
}

// ---------------------------------------------------------------------------
// listCatalogues
// ---------------------------------------------------------------------------

export async function listCatalogues(tenantId: string, opts: ListOptions = {}): Promise<ListResult<CvcCatalogue>> {
  const { limit, offset } = opts;

  const where = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  const [total, data] = await Promise.all([
    prisma.cvcCatalogue.count({ where }),
    prisma.cvcCatalogue.findMany({
      where,
      include: { _count: { select: { schemes: true } } },
      take: limit ?? 20,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return { data, total };
}

// ---------------------------------------------------------------------------
// getCatalogueById
// ---------------------------------------------------------------------------

export async function getCatalogueById(id: string, tenantId: string): Promise<CvcCatalogue | null> {
  return prisma.cvcCatalogue.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    include: { _count: { select: { schemes: true } } },
  });
}

// ---------------------------------------------------------------------------
// listSchemes
// ---------------------------------------------------------------------------

export async function listSchemes(
  tenantId: string,
  opts: ListSchemesOptions = {},
): Promise<ListResult<ConformityScheme>> {
  const { catalogueId, limit, offset } = opts;

  const where: Prisma.ConformitySchemeWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  if (catalogueId !== undefined) {
    where.catalogueId = catalogueId;
  }

  const [total, data] = await Promise.all([
    prisma.conformityScheme.count({ where }),
    prisma.conformityScheme.findMany({
      where,
      include: { _count: { select: { profiles: true } } },
      take: limit ?? 20,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return { data, total };
}

// ---------------------------------------------------------------------------
// getSchemeById
// ---------------------------------------------------------------------------

export async function getSchemeById(id: string, tenantId: string): Promise<ConformityScheme | null> {
  return prisma.conformityScheme.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    include: { profiles: true },
  });
}

// ---------------------------------------------------------------------------
// listProfiles
// ---------------------------------------------------------------------------

export async function listProfiles(
  tenantId: string,
  opts: ListProfilesOptions = {},
): Promise<ListResult<ConformityProfile>> {
  const { schemeId, limit, offset } = opts;

  const where: Prisma.ConformityProfileWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  if (schemeId !== undefined) {
    where.schemeId = schemeId;
  }

  const [total, data] = await Promise.all([
    prisma.conformityProfile.count({ where }),
    prisma.conformityProfile.findMany({
      where,
      include: { _count: { select: { criteria: true } } },
      take: limit ?? 20,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return { data, total };
}

// ---------------------------------------------------------------------------
// getProfileById
// ---------------------------------------------------------------------------

export async function getProfileById(id: string, tenantId: string) {
  return prisma.conformityProfile.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    include: {
      criteria: {
        orderBy: { criterion: { name: 'asc' } },
        include: { criterion: true },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// listCriteria
// ---------------------------------------------------------------------------

export async function listCriteria(tenantId: string, opts: ListCriteriaOptions = {}): Promise<ListResult<Criterion>> {
  const { profileId, limit, offset } = opts;

  const where: Prisma.CriterionWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  if (profileId !== undefined) {
    where.profiles = { some: { profileId } };
  }

  const [total, data] = await Promise.all([
    prisma.criterion.count({ where }),
    prisma.criterion.findMany({
      where,
      take: limit ?? 20,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return { data, total };
}

// ---------------------------------------------------------------------------
// getCriterionById
// ---------------------------------------------------------------------------

export async function getCriterionById(id: string, tenantId: string) {
  return prisma.criterion.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    include: {
      profiles: { include: { profile: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// findCriteriaByCanonicalIds
// ---------------------------------------------------------------------------

export async function findCriteriaByCanonicalIds(tenantId: string, canonicalIds: string[]): Promise<Criterion[]> {
  return prisma.criterion.findMany({
    where: {
      canonicalId: { in: canonicalIds },
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
  });
}
