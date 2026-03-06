import { Identifier, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

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
      OR: [{ tenantId }, { tenantId: 'system' }],
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
  return prisma.$transaction(async (tx) => {
    await validateIdentifierValue(tx, input.schemeId, input.value, input.tenantId);

    return tx.identifier.create({
      data: {
        tenantId: input.tenantId,
        schemeId: input.schemeId,
        value: input.value,
      },
      include: {
        scheme: true,
      },
    });
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
      take: limit ?? 100,
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
  return prisma.$transaction(async (tx) => {
    const existing = await tx.identifier.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Identifier not found or access denied');
    }

    if (input.value !== undefined) {
      await validateIdentifierValue(tx, existing.schemeId, input.value, tenantId);
    }

    return tx.identifier.update({
      where: { id },
      data: {
        ...(input.value !== undefined && { value: input.value }),
      },
      include: {
        scheme: true,
      },
    });
  });
}

/**
 * Deletes an identifier.
 * Validates that the identifier belongs to the specified organisation.
 */
export async function deleteIdentifier(id: string, tenantId: string): Promise<Identifier> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.identifier.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Identifier not found or access denied');
    }

    return tx.identifier.delete({
      where: { id },
    });
  });
}
