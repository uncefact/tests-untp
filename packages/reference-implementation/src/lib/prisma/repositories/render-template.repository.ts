import { Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';

/**
 * Include shape used by all render template queries.
 * Includes the parent credential type config.
 */
const RENDER_TEMPLATE_INCLUDE = {
  credentialTypeConfig: true,
} as const;

/**
 * A render template with its credential type config relation.
 * Matches the include shape defined by RENDER_TEMPLATE_INCLUDE.
 */
export type RenderTemplateWithRelations = Prisma.RenderTemplateGetPayload<{
  include: typeof RENDER_TEMPLATE_INCLUDE;
}>;

/**
 * Input for creating a new render template.
 */
export type CreateRenderTemplateInput = {
  name: string;
  credentialTypeConfigId: string;
  storageUrl: string;
  hash: string;
  isPrimary?: boolean;
};

/**
 * Input for updating an existing render template.
 */
export type UpdateRenderTemplateInput = {
  name?: string;
  storageUrl?: string;
  hash?: string;
  isPrimary?: boolean;
};

/**
 * Options for listing render templates.
 */
export type ListRenderTemplatesOptions = {
  credentialTypeConfigId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Creates a new render template scoped to a tenant.
 * When isPrimary is true, first unsets any existing primary for the same
 * tenant + credentialTypeConfigId combination.
 */
export async function createRenderTemplate(
  tenantId: string,
  input: CreateRenderTemplateInput,
): Promise<RenderTemplateWithRelations> {
  return prisma.$transaction(async (tx) => {
    if (input.isPrimary) {
      await tx.renderTemplate.updateMany({
        where: {
          tenantId,
          credentialTypeConfigId: input.credentialTypeConfigId,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    return tx.renderTemplate.create({
      data: {
        tenantId,
        name: input.name,
        credentialTypeConfigId: input.credentialTypeConfigId,
        storageUrl: input.storageUrl,
        hash: input.hash,
        isPrimary: input.isPrimary ?? false,
      },
      include: RENDER_TEMPLATE_INCLUDE,
    });
  });
}

/**
 * Retrieves a render template by ID, scoped to a tenant.
 * Templates are always tenant-scoped (no system defaults).
 */
export async function getRenderTemplateById(id: string, tenantId: string): Promise<RenderTemplateWithRelations | null> {
  return prisma.renderTemplate.findFirst({
    where: {
      id,
      tenantId,
    },
    include: RENDER_TEMPLATE_INCLUDE,
  });
}

/**
 * Lists render templates for a tenant.
 * Supports filtering by credentialTypeConfigId and pagination.
 */
export async function listRenderTemplates(
  tenantId: string,
  options: ListRenderTemplatesOptions = {},
): Promise<RenderTemplateWithRelations[]> {
  const { credentialTypeConfigId, limit, offset } = options;

  const where: Prisma.RenderTemplateWhereInput = {
    tenantId,
  };

  if (credentialTypeConfigId !== undefined) {
    where.credentialTypeConfigId = credentialTypeConfigId;
  }

  return prisma.renderTemplate.findMany({
    where,
    include: RENDER_TEMPLATE_INCLUDE,
    take: limit ?? 100,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Updates a render template. Only tenant-owned templates can be updated.
 * When setting isPrimary to true, unsets any existing primary for the same
 * tenant + credentialTypeConfigId combination (excluding self).
 */
export async function updateRenderTemplate(
  id: string,
  tenantId: string,
  input: UpdateRenderTemplateInput,
): Promise<RenderTemplateWithRelations> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.renderTemplate.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Render template not found or access denied');
    }

    if (input.isPrimary) {
      await tx.renderTemplate.updateMany({
        where: {
          tenantId,
          credentialTypeConfigId: existing.credentialTypeConfigId,
          isPrimary: true,
          NOT: { id },
        },
        data: { isPrimary: false },
      });
    }

    return tx.renderTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.storageUrl !== undefined && { storageUrl: input.storageUrl }),
        ...(input.hash !== undefined && { hash: input.hash }),
        ...(input.isPrimary !== undefined && { isPrimary: input.isPrimary }),
      },
      include: RENDER_TEMPLATE_INCLUDE,
    });
  });
}

/**
 * Deletes a render template. Only tenant-owned templates can be deleted.
 */
export async function deleteRenderTemplate(id: string, tenantId: string): Promise<RenderTemplateWithRelations> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.renderTemplate.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new NotFoundError('Render template not found or access denied');
    }

    return tx.renderTemplate.delete({
      where: { id },
      include: RENDER_TEMPLATE_INCLUDE,
    });
  });
}

/**
 * Returns the primary render template for a tenant + credentialTypeConfigId
 * combination, or null if none is set.
 */
export async function getPrimaryRenderTemplate(
  tenantId: string,
  credentialTypeConfigId: string,
): Promise<RenderTemplateWithRelations | null> {
  return prisma.renderTemplate.findFirst({
    where: {
      tenantId,
      credentialTypeConfigId,
      isPrimary: true,
    },
    include: RENDER_TEMPLATE_INCLUDE,
  });
}
