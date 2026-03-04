import { Prisma } from '../generated';
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';
import { NotFoundError } from '@/lib/api/errors';

/**
 * Include shape used by all render template queries.
 * Includes the parent data model.
 */
const RENDER_TEMPLATE_INCLUDE = {
  dataModel: true,
} as const;

/**
 * A render template with its data model relation.
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
  dataModelId: string;
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
  dataModelId?: string;
  limit?: number;
  offset?: number;
};

/**
 * Creates a new render template scoped to a tenant.
 * When isPrimary is true, first unsets any existing primary for the same
 * tenant + dataModelId combination.
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
          dataModelId: input.dataModelId,
          isPrimary: true,
        },
        data: { isPrimary: false },
      });
    }

    return tx.renderTemplate.create({
      data: {
        tenantId,
        name: input.name,
        dataModelId: input.dataModelId,
        storageUrl: input.storageUrl,
        hash: input.hash,
        isPrimary: input.isPrimary ?? false,
      },
      include: RENDER_TEMPLATE_INCLUDE,
    });
  });
}

/**
 * Retrieves a render template by ID.
 * Returns templates visible to the tenant OR system-provisioned.
 */
export async function getRenderTemplateById(id: string, tenantId: string): Promise<RenderTemplateWithRelations | null> {
  return prisma.renderTemplate.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    include: RENDER_TEMPLATE_INCLUDE,
  });
}

/**
 * Lists render templates for a tenant, including system-provisioned templates.
 * Supports filtering by dataModelId and pagination.
 */
export async function listRenderTemplates(
  tenantId: string,
  options: ListRenderTemplatesOptions = {},
): Promise<{ data: RenderTemplateWithRelations[]; total: number }> {
  const { dataModelId, limit, offset } = options;

  const where: Prisma.RenderTemplateWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  if (dataModelId !== undefined) {
    where.dataModelId = dataModelId;
  }

  const [data, total] = await Promise.all([
    prisma.renderTemplate.findMany({
      where,
      include: RENDER_TEMPLATE_INCLUDE,
      take: limit ?? 20,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.renderTemplate.count({ where }),
  ]);

  return { data, total };
}

/**
 * Updates a render template. Only tenant-owned templates can be updated.
 * When setting isPrimary to true, unsets any existing primary for the same
 * tenant + dataModelId combination (excluding self).
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
          dataModelId: existing.dataModelId,
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
 * Returns the primary render template for a tenant + dataModelId
 * combination, including system-provisioned templates.
 * Returns null if none is set.
 */
export async function getPrimaryRenderTemplate(
  tenantId: string,
  dataModelId: string,
): Promise<RenderTemplateWithRelations | null> {
  return prisma.renderTemplate.findFirst({
    where: {
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
      dataModelId,
      isPrimary: true,
    },
    include: RENDER_TEMPLATE_INCLUDE,
  });
}
