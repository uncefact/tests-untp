import { LinkRegistration, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { isForeignKeyViolationOn, mapDatabaseError } from '@/lib/prisma/db-errors';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

export type CreateLinkRegistrationInput = {
  tenantId: string;
  identifierId: string;
  idrLinkId: string;
  linkType: string;
  targetUrl: string;
  mimeType: string;
  resolverUri: string;
  qualifierPath?: string;
};

/**
 * Bulk-creates link registration audit records.
 */
export async function createManyLinkRegistrations(inputs: CreateLinkRegistrationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  try {
    await prisma.linkRegistration.createMany({ data: inputs });
  } catch (e) {
    // An identifierId violation means the identifier vanished after the
    // route's pre-check; it surfaces as that pre-check's 404.
    if (isForeignKeyViolationOn(e, 'identifierId')) {
      throw new NotFoundError('Identifier not found');
    }
    throw e;
  }
}

/**
 * Gets a link registration by IDR link ID, scoped to an identifier and tenant.
 */
export async function getLinkRegistrationByIdrLinkId(
  idrLinkId: string,
  identifierId: string,
  tenantId: string,
): Promise<LinkRegistration | null> {
  return prisma.linkRegistration.findFirst({
    where: { idrLinkId, identifierId, tenantId },
  });
}

/**
 * Lists link registrations for an identifier with pagination support.
 */
export async function listLinkRegistrations(
  identifierId: string,
  tenantId: string,
  limit?: number,
  offset?: number,
): Promise<{ data: LinkRegistration[]; total: number }> {
  const where = { identifierId, tenantId };
  const [data, total] = await Promise.all([
    prisma.linkRegistration.findMany({
      where,
      orderBy: { publishedAt: 'desc' },
      take: limit ?? DEFAULT_PAGE_LIMIT,
      skip: offset,
    }),
    prisma.linkRegistration.count({ where }),
  ]);
  return { data, total };
}

/**
 * Updates a link registration's mutable fields after a successful upstream PATCH.
 * Scoped by IDR link ID, identifier, and tenant.
 */
export async function updateLinkRegistration(
  idrLinkId: string,
  identifierId: string,
  tenantId: string,
  data: { linkType?: string; targetUrl?: string; mimeType?: string },
): Promise<LinkRegistration> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.linkRegistration.findFirst({
      where: { idrLinkId, identifierId, tenantId },
    });
    if (!existing) {
      throw new NotFoundError('Link registration not found');
    }
    try {
      return await tx.linkRegistration.update({
        where: { id: existing.id },
        data,
      });
    } catch (e) {
      mapDatabaseError(e, { notFound: 'Link registration not found' });
    }
  });
}

/**
 * Deletes a link registration by IDR link ID.
 * Validates ownership via tenant and identifier scoping.
 */
export async function deleteLinkRegistration(
  idrLinkId: string,
  identifierId: string,
  tenantId: string,
): Promise<LinkRegistration> {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.linkRegistration.findFirst({
      where: { idrLinkId, identifierId, tenantId },
    });
    if (!existing) {
      throw new NotFoundError('Link registration not found');
    }
    try {
      return await tx.linkRegistration.delete({ where: { id: existing.id } });
    } catch (e) {
      mapDatabaseError(e, { notFound: 'Link registration not found' });
    }
  });
}
