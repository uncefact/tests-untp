import { Identifier, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

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
async function validateIdentifierValue(schemeId: string, value: string, tenantId: string): Promise<void> {
  const scheme = await prisma.identifierScheme.findFirst({
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
  await validateIdentifierValue(input.schemeId, input.value, input.tenantId);

  return prisma.identifier.create({
    data: {
      tenantId: input.tenantId,
      schemeId: input.schemeId,
      value: input.value,
    },
    include: {
      scheme: true,
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
 */
export async function listIdentifiers(tenantId: string, options: ListIdentifiersOptions = {}): Promise<Identifier[]> {
  const { schemeId, limit, offset } = options;

  const where: Prisma.IdentifierWhereInput = {
    tenantId,
  };

  if (schemeId !== undefined) {
    where.schemeId = schemeId;
  }

  return prisma.identifier.findMany({
    where,
    include: {
      scheme: true,
    },
    take: limit ?? 100,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
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
  const existing = await prisma.identifier.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new NotFoundError('Identifier not found or access denied');
  }

  if (input.value !== undefined) {
    await validateIdentifierValue(existing.schemeId, input.value, tenantId);
  }

  return prisma.identifier.update({
    where: { id },
    data: {
      ...(input.value !== undefined && { value: input.value }),
    },
    include: {
      scheme: true,
    },
  });
}

/**
 * Deletes an identifier.
 * Validates that the identifier belongs to the specified organisation.
 */
export async function deleteIdentifier(id: string, tenantId: string): Promise<Identifier> {
  const existing = await prisma.identifier.findFirst({
    where: { id, tenantId },
  });

  if (!existing) {
    throw new NotFoundError('Identifier not found or access denied');
  }

  return prisma.identifier.delete({
    where: { id },
  });
}
