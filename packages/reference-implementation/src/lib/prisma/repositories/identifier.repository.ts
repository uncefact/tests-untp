import { Identifier, Prisma } from '../generated';
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';
import { NotFoundError } from '@/lib/api/errors';
import { isForeignKeyViolationOn, mapDatabaseError } from '@/lib/prisma/db-errors';
import { ValidationError } from '@/lib/api/validation';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

type TransactionClient = Prisma.TransactionClient;

/**
 * An identifier with its full scheme relation (including registrar and qualifiers).
 * Matches the include shape used by `getIdentifierById`.
 */
export type IdentifierWithScheme = Prisma.IdentifierGetPayload<{
  include: {
    scheme: {
      include: {
        registrar: true;
        qualifiers: true;
      };
    };
  };
}>;

/**
 * Input for creating a new identifier
 */
export type CreateIdentifierInput = {
  tenantId: string;
  schemeId: string;
  value: string;
};

/**
 * Input for updating an identifier
 */
export type UpdateIdentifierInput = {
  value?: string;
};

/**
 * Options for listing identifiers
 */
export type ListIdentifiersOptions = {
  schemeId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Validates an identifier value against the scheme's validation pattern.
 * Looks up the scheme by ID, scoped to the tenant or system defaults.
 * Throws NotFoundError if the scheme does not exist.
 * Throws ValidationError if the value does not match the pattern.
 */
async function validateIdentifierValue(
  tx: TransactionClient,
  schemeId: string,
  value: string,
  tenantId: string,
): Promise<void> {
  const scheme = await tx.identifierScheme.findFirst({
    where: {
      id: schemeId,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
  });

  if (!scheme) {
    throw new NotFoundError('Identifier scheme not found');
  }

  const regex = new RegExp(scheme.validationPattern);
  if (!regex.test(value)) {
    throw new ValidationError(
      `Identifier value "${value}" does not match scheme validation pattern: ${scheme.validationPattern}`,
    );
  }
}

/**
 * Creates a new identifier after validating the value against the scheme's pattern.
 * Identifiers are scoped to a single tenant (not shared with system defaults).
 */
export async function createIdentifier(input: CreateIdentifierInput): Promise<Identifier> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    await validateIdentifierValue(tx, input.schemeId, input.value, input.tenantId);

    try {
      return await tx.identifier.create({
        data: {
          tenantId: input.tenantId,
          schemeId: input.schemeId,
          value: input.value,
        },
        include: {
          scheme: true,
        },
      });
    } catch (e) {
      // A schemeId violation means the scheme vanished after the pre-check in
      // validateIdentifierValue; it surfaces as that pre-check's 404.
      if (isForeignKeyViolationOn(e, 'schemeId')) {
        throw new NotFoundError('Identifier scheme not found');
      }
      mapDatabaseError(e, { conflict: 'An identifier with this value already exists for the scheme' });
    }
  });
}

/**
 * Finds the identifiers matching a value for a tenant, with their scheme,
 * registrar and qualifiers.
 *
 * Returns every match rather than the first: `Identifier` is unique on
 * (schemeId, value, tenantId), so one value can legitimately exist under two
 * schemes (a GTIN and an internal code that coincide). Publishing must not
 * guess between them, so the caller decides what an ambiguous result means
 * (ADR-044). Passing `schemeId` narrows to the exact identifier when the
 * caller named the scheme to publish under.
 */
export async function findIdentifiersByValue(
  value: string,
  tenantId: string,
  schemeId?: string,
): Promise<IdentifierWithScheme[]> {
  return prisma.identifier.findMany({
    where: {
      value,
      tenantId,
      ...(schemeId ? { schemeId } : {}),
    },
    include: {
      scheme: {
        include: {
          registrar: true,
          qualifiers: true,
        },
      },
    },
  });
}

/**
 * Retrieves an identifier by ID, scoped to an organisation.
 * Identifiers belong to a single tenant — no system default sharing.
 * Includes the full scheme with registrar and qualifiers.
 */
export async function getIdentifierById(id: string, tenantId: string): Promise<IdentifierWithScheme | null> {
  return prisma.identifier.findFirst({
    where: {
      id,
      tenantId,
    },
    include: {
      scheme: {
        include: {
          registrar: true,
          qualifiers: true,
        },
      },
    },
  });
}

/**
 * Lists identifiers for an organisation.
 * Supports optional filtering by schemeId.
 * Returns flat identifier records (no scheme include) alongside a total count.
 */
export async function listIdentifiers(
  tenantId: string,
  options: ListIdentifiersOptions = {},
): Promise<{ data: Identifier[]; total: number }> {
  const { schemeId, limit, offset } = options;

  const where: Prisma.IdentifierWhereInput = {
    tenantId,
  };

  if (schemeId !== undefined) {
    where.schemeId = schemeId;
  }

  const [data, total] = await Promise.all([
    prisma.identifier.findMany({
      where,
      take: limit ?? DEFAULT_PAGE_LIMIT,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.identifier.count({ where }),
  ]);

  return { data, total };
}

/**
 * Updates an identifier's value. Re-validates against the scheme's pattern.
 * Validates that the identifier belongs to the specified organisation.
 */
export async function updateIdentifier(
  id: string,
  tenantId: string,
  input: UpdateIdentifierInput,
): Promise<Identifier> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.identifier.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Identifier not found');
    }

    if (input.value !== undefined) {
      await validateIdentifierValue(tx, existing.schemeId, input.value, tenantId);
    }

    try {
      return await tx.identifier.update({
        where: { id },
        data: {
          ...(input.value !== undefined && { value: input.value }),
        },
        include: {
          scheme: true,
        },
      });
    } catch (e) {
      mapDatabaseError(e, {
        conflict: 'An identifier with this value already exists for the scheme',
        notFound: 'Identifier not found',
      });
    }
  });
}

/**
 * Deletes an identifier.
 * Validates that the identifier belongs to the specified organisation.
 */
export async function deleteIdentifier(id: string, tenantId: string): Promise<Identifier> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.identifier.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Identifier not found');
    }

    try {
      return await tx.identifier.delete({
        where: { id },
      });
    } catch (e) {
      mapDatabaseError(e, { notFound: 'Identifier not found' });
    }
  });
}
