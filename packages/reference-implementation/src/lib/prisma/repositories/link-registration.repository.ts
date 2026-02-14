import { LinkRegistration } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';

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
 * Creates a single link registration audit record.
 */
export async function createLinkRegistration(input: CreateLinkRegistrationInput): Promise<LinkRegistration> {
  return prisma.linkRegistration.create({ data: input });
}

/**
 * Bulk-creates link registration audit records.
 */
export async function createManyLinkRegistrations(inputs: CreateLinkRegistrationInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await prisma.linkRegistration.createMany({ data: inputs });
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
 * Lists all link registrations for an identifier.
 */
export async function listLinkRegistrations(identifierId: string, tenantId: string): Promise<LinkRegistration[]> {
  return prisma.linkRegistration.findMany({
    where: { identifierId, tenantId },
    orderBy: { publishedAt: 'desc' },
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
  const existing = await prisma.linkRegistration.findFirst({
    where: { idrLinkId, identifierId, tenantId },
  });
  if (!existing) {
    throw new NotFoundError('Link registration not found');
  }
  return prisma.linkRegistration.delete({ where: { id: existing.id } });
}
