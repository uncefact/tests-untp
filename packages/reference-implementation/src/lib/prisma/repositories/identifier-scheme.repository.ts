import { IdentifierScheme, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';

const SYSTEM_TENANT_ID = 'system';

/**
 * Input for creating a new identifier scheme
 */
export type CreateIdentifierSchemeInput = {
  tenantId: string;
  registrarId: string;
  name: string;
  primaryKey: string;
  validationPattern: string;
  namespace?: string;
  idrServiceInstanceId?: string;
  isDefault?: boolean;
  qualifiers?: Array<{
    key: string;
    description: string;
    validationPattern?: string;
  }>;
};

/**
 * Input for updating an identifier scheme
 */
export type UpdateIdentifierSchemeInput = {
  name?: string;
  primaryKey?: string;
  validationPattern?: string;
  namespace?: string;
  idrServiceInstanceId?: string | null;
  qualifiers?: Array<{
    key: string;
    description: string;
    validationPattern?: string;
  }>;
};

/**
 * Options for listing identifier schemes
 */
export type ListIdentifierSchemesOptions = {
  registrarId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Creates a new identifier scheme with optional nested qualifiers.
 */
export async function createIdentifierScheme(input: CreateIdentifierSchemeInput): Promise<IdentifierScheme> {
  return prisma.identifierScheme.create({
    data: {
      tenantId: input.tenantId,
      registrarId: input.registrarId,
      name: input.name,
      primaryKey: input.primaryKey,
      validationPattern: input.validationPattern,
      namespace: input.namespace,
      idrServiceInstanceId: input.idrServiceInstanceId,
      isDefault: input.isDefault ?? false,
      ...(input.qualifiers && {
        qualifiers: {
          create: input.qualifiers.map((q) => ({
            key: q.key,
            description: q.description,
            validationPattern: q.validationPattern,
          })),
        },
      }),
    },
    include: {
      qualifiers: true,
      registrar: true,
    },
  });
}

/**
 * Retrieves an identifier scheme by ID, scoped to an organisation.
 * Returns the scheme if owned by the specified tenant or if it's a system default.
 * Includes qualifiers and registrar.
 */
export async function getIdentifierSchemeById(id: string, tenantId: string): Promise<IdentifierScheme | null> {
  return prisma.identifierScheme.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    include: {
      qualifiers: true,
      registrar: true,
    },
  });
}

/**
 * Lists identifier schemes for an organisation, including system defaults.
 * Supports optional filtering by registrarId.
 */
export async function listIdentifierSchemes(
  tenantId: string,
  options: ListIdentifierSchemesOptions = {},
): Promise<IdentifierScheme[]> {
  const { registrarId, limit, offset } = options;

  const where: Prisma.IdentifierSchemeWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  if (registrarId !== undefined) {
    where.registrarId = registrarId;
  }

  return prisma.identifierScheme.findMany({
    where,
    include: {
      qualifiers: true,
      registrar: true,
    },
    take: limit ?? 100,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Updates an identifier scheme. Cannot update system defaults.
 * When qualifiers are provided, deletes existing qualifiers and recreates them
 * within a transaction.
 */
export async function updateIdentifierScheme(
  id: string,
  tenantId: string,
  input: UpdateIdentifierSchemeInput,
): Promise<IdentifierScheme> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.identifierScheme.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Identifier scheme not found or access denied');
    }

    // If qualifiers are provided, delete existing and recreate
    if (input.qualifiers !== undefined) {
      await tx.schemeQualifier.deleteMany({
        where: { schemeId: id },
      });
    }

    return tx.identifierScheme.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.primaryKey !== undefined && { primaryKey: input.primaryKey }),
        ...(input.validationPattern !== undefined && { validationPattern: input.validationPattern }),
        ...(input.namespace !== undefined && { namespace: input.namespace }),
        ...(input.idrServiceInstanceId !== undefined && {
          idrServiceInstanceId: input.idrServiceInstanceId,
        }),
        ...(input.qualifiers !== undefined && {
          qualifiers: {
            create: input.qualifiers.map((q) => ({
              key: q.key,
              description: q.description,
              validationPattern: q.validationPattern,
            })),
          },
        }),
      },
      include: {
        qualifiers: true,
        registrar: true,
      },
    });
  });
}

/**
 * Deletes an identifier scheme. Cannot delete system defaults.
 * Validates that the scheme belongs to the specified organisation.
 */
export async function deleteIdentifierScheme(id: string, tenantId: string): Promise<IdentifierScheme> {
  const existing = await prisma.identifierScheme.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new NotFoundError('Identifier scheme not found or access denied');
  }

  return prisma.identifierScheme.delete({
    where: { id },
  });
}
