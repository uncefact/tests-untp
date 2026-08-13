import { IdentifierScheme, Prisma } from '../generated';
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';
import { ConflictError, NotFoundError, ServiceInstanceNotFoundError } from '@/lib/api/errors';
import { isForeignKeyViolation, isForeignKeyViolationOn, mapDatabaseError } from '@/lib/prisma/db-errors';
import { ValidationError } from '@/lib/api/validation';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

/**
 * Input for creating a new identifier scheme
 */
export type CreateIdentifierSchemeInput = {
  tenantId: string;
  registrarId: string;
  name: string;
  primaryKey: string;
  validationPattern: string;
  linkTemplate: string;
  idrServiceInstanceId?: string;
  qualifiers?: Array<{
    key: string;
    description: string;
    validationPattern: string;
    order?: number;
  }>;
};

/**
 * Input for updating an identifier scheme
 */
export type UpdateIdentifierSchemeInput = {
  name?: string;
  primaryKey?: string;
  validationPattern?: string;
  linkTemplate?: string;
  idrServiceInstanceId?: string | null;
  qualifiers?: Array<{
    key: string;
    description: string;
    validationPattern: string;
    order?: number;
  }>;
};

/**
 * Options for listing identifier schemes
 */
type QualifierInput = { key: string; description: string; validationPattern: string; order?: number };

export type ListIdentifierSchemesOptions = {
  registrarId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Rejects duplicate qualifier keys within a single request. Duplicates in the
 * request array are deterministic input, so they are validated up front rather
 * than surfaced through the (schemeId, key) unique constraint.
 */
function validateQualifierKeys(qualifiers: QualifierInput[] | undefined): void {
  if (!qualifiers) return;
  const keys = qualifiers.map((q: QualifierInput) => q.key);
  if (new Set(keys).size !== keys.length) {
    throw new ValidationError('Qualifier keys must be unique');
  }
}

/**
 * Creates a new identifier scheme with optional nested qualifiers.
 */
export async function createIdentifierScheme(input: CreateIdentifierSchemeInput): Promise<IdentifierScheme> {
  validateQualifierKeys(input.qualifiers);

  try {
    return await prisma.identifierScheme.create({
      data: {
        tenantId: input.tenantId,
        registrarId: input.registrarId,
        name: input.name,
        primaryKey: input.primaryKey,
        validationPattern: input.validationPattern,
        linkTemplate: input.linkTemplate,
        idrServiceInstanceId: input.idrServiceInstanceId,
        ...(input.qualifiers && {
          qualifiers: {
            create: input.qualifiers.map((q: QualifierInput) => ({
              key: q.key,
              description: q.description,
              validationPattern: q.validationPattern,
              ...(q.order !== undefined && { order: q.order }),
            })),
          },
        }),
      },
      include: {
        qualifiers: true,
        registrar: true,
      },
    });
  } catch (e) {
    // The insert carries three foreign keys; the route pre-checks the
    // registrar and the IDR instance with 404s, so a reference deleted after
    // its pre-check surfaces as that pre-check's 404, matched per column; a
    // violation on any other column rethrows via mapDatabaseError's
    // fall-through.
    if (isForeignKeyViolationOn(e, 'registrarId')) {
      throw new NotFoundError('Registrar not found');
    }
    if (isForeignKeyViolationOn(e, 'idrServiceInstanceId')) {
      throw new ServiceInstanceNotFoundError(String(input.idrServiceInstanceId));
    }
    mapDatabaseError(e, {
      conflict: 'An identifier scheme with this primary key already exists for the registrar',
    });
  }
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
): Promise<{ data: IdentifierScheme[]; total: number }> {
  const { registrarId, limit, offset } = options;

  const where: Prisma.IdentifierSchemeWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  if (registrarId !== undefined) {
    where.registrarId = registrarId;
  }

  const [data, total] = await Promise.all([
    prisma.identifierScheme.findMany({
      where,
      include: {
        qualifiers: true,
      },
      take: limit ?? DEFAULT_PAGE_LIMIT,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.identifierScheme.count({ where }),
  ]);

  return { data, total };
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
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.identifierScheme.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Identifier scheme not found');
    }

    validateQualifierKeys(input.qualifiers);

    // If qualifiers are provided, delete existing and recreate. The recreate
    // is guarded separately from the scheme update so a unique-constraint
    // violation on (schemeId, key), such as a concurrent update racing this
    // one, reports the qualifier conflict rather than a primary-key conflict.
    if (input.qualifiers !== undefined) {
      await tx.schemeQualifier.deleteMany({
        where: { schemeId: id },
      });
      if (input.qualifiers.length > 0) {
        try {
          await tx.schemeQualifier.createMany({
            data: input.qualifiers.map((q: QualifierInput) => ({
              schemeId: id,
              key: q.key,
              description: q.description,
              validationPattern: q.validationPattern,
              ...(q.order !== undefined && { order: q.order }),
            })),
          });
        } catch (e) {
          // The qualifier rows' only foreign key is schemeId, pre-checked
          // above; a violation surfaces as that pre-check's 404.
          if (isForeignKeyViolation(e)) {
            throw new NotFoundError('Identifier scheme not found');
          }
          mapDatabaseError(e, { conflict: 'A qualifier with this key already exists for the scheme' });
        }
      }
    }

    try {
      return await tx.identifierScheme.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.primaryKey !== undefined && { primaryKey: input.primaryKey }),
          ...(input.validationPattern !== undefined && { validationPattern: input.validationPattern }),
          ...(input.linkTemplate !== undefined && { linkTemplate: input.linkTemplate }),
          ...(input.idrServiceInstanceId !== undefined && {
            idrServiceInstanceId: input.idrServiceInstanceId,
          }),
        },
        include: {
          qualifiers: true,
          registrar: true,
        },
      });
    } catch (e) {
      // The update's only failable reference is idrServiceInstanceId, which
      // the route pre-checks with a 404; an instance deleted after that check
      // surfaces as the same 404.
      if (isForeignKeyViolationOn(e, 'idrServiceInstanceId')) {
        throw new ServiceInstanceNotFoundError(String(input.idrServiceInstanceId));
      }
      mapDatabaseError(e, {
        conflict: 'An identifier scheme with this primary key already exists for the registrar',
        notFound: 'Identifier scheme not found',
      });
    }
  });
}

/**
 * Deletes an identifier scheme. Cannot delete system defaults.
 * Validates that the scheme belongs to the specified organisation.
 */
export async function deleteIdentifierScheme(id: string, tenantId: string): Promise<IdentifierScheme> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.identifierScheme.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Identifier scheme not found');
    }

    try {
      return await tx.identifierScheme.delete({
        where: { id },
      });
    } catch (e) {
      // Identifier.scheme is declared with onDelete: Restrict, so the
      // foreign-key violation here means dependants block the delete (a
      // conflict), not that a referenced record is missing (a bad request).
      if (isForeignKeyViolation(e)) {
        throw new ConflictError('The identifier scheme has identifiers and cannot be deleted');
      }
      mapDatabaseError(e, { notFound: 'Identifier scheme not found' });
    }
  });
}
