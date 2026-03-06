import { Prisma, RenderMethodType } from '../generated';
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
  renderMethodType: RenderMethodType;
  storageUrl: string;
  hash: string;
  isDefault?: boolean;
  storageServiceInstanceId?: string;
  storageExternalId?: string;
  storageBucket?: string;
  storageContentType?: string;
  inline?: boolean | null;
  mediaType?: string | null;
  mediaQuery?: string | null;
};

/**
 * Input for updating an existing render template.
 */
export type UpdateRenderTemplateInput = {
  name?: string;
  storageUrl?: string;
  hash?: string;
  isDefault?: boolean;
  storageServiceInstanceId?: string;
  storageExternalId?: string;
  storageBucket?: string;
  storageContentType?: string;
  inline?: boolean | null;
  mediaType?: string | null;
  mediaQuery?: string | null;
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
 * When a system default render template has isDefault true but the tenant
 * has set their own default for the same dataModelId, the system template's
 * isDefault should appear as false for that tenant.
 */
async function applyTenantDefaultOverride(
  template: RenderTemplateWithRelations | null,
  tenantId: string,
): Promise<RenderTemplateWithRelations | null> {
  if (!template || template.tenantId !== SYSTEM_TENANT_ID || !template.isDefault) return template;

  const tenantDefault = await prisma.renderTemplate.findFirst({
    where: {
      tenantId,
      dataModelId: template.dataModelId,
      isDefault: true,
    },
    select: { id: true },
  });

  return tenantDefault ? { ...template, isDefault: false } : template;
}

/**
 * Creates a new render template scoped to a tenant.
 * When isDefault is true, first unsets any existing default for the same
 * tenant + dataModelId combination.
 */
export async function createRenderTemplate(
  tenantId: string,
  input: CreateRenderTemplateInput,
): Promise<RenderTemplateWithRelations> {
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.renderTemplate.updateMany({
        where: {
          tenantId,
          dataModelId: input.dataModelId,
          isDefault: true,
        },
        data: { isDefault: false },
      });
    }

    return tx.renderTemplate.create({
      data: {
        tenantId,
        name: input.name,
        dataModelId: input.dataModelId,
        renderMethodType: input.renderMethodType,
        storageUrl: input.storageUrl,
        hash: input.hash,
        isDefault: input.isDefault ?? false,
        storageServiceInstanceId: input.storageServiceInstanceId,
        storageExternalId: input.storageExternalId,
        storageBucket: input.storageBucket,
        storageContentType: input.storageContentType,
        inline: input.inline,
        mediaType: input.mediaType,
        mediaQuery: input.mediaQuery,
      },
      include: RENDER_TEMPLATE_INCLUDE,
    });
  });
}

/**
 * Retrieves a render template by ID.
 * Returns templates visible to the tenant OR system-provisioned.
 * Applies tenant default override for system templates.
 */
export async function getRenderTemplateById(id: string, tenantId: string): Promise<RenderTemplateWithRelations | null> {
  const result = await prisma.renderTemplate.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    include: RENDER_TEMPLATE_INCLUDE,
  });

  return applyTenantDefaultOverride(result, tenantId);
}

/**
 * Lists render templates for a tenant, including system-provisioned templates.
 * Supports filtering by dataModelId and pagination.
 * Applies tenant default override for system templates.
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

  const [data, total, tenantDefaults] = await Promise.all([
    prisma.renderTemplate.findMany({
      where,
      include: RENDER_TEMPLATE_INCLUDE,
      take: limit ?? 20,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.renderTemplate.count({ where }),
    prisma.renderTemplate.findMany({
      where: { tenantId, isDefault: true },
      select: { dataModelId: true },
    }),
  ]);

  const tenantDefaultDataModels = new Set(tenantDefaults.map((t) => t.dataModelId));

  return {
    data: data.map((t) =>
      t.tenantId === SYSTEM_TENANT_ID && t.isDefault && tenantDefaultDataModels.has(t.dataModelId)
        ? { ...t, isDefault: false }
        : t,
    ),
    total,
  };
}

/**
 * Updates a render template. Only tenant-owned templates can be updated.
 * When setting isDefault to true, unsets any existing default for the same
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

    if (input.isDefault) {
      await tx.renderTemplate.updateMany({
        where: {
          tenantId,
          dataModelId: existing.dataModelId,
          isDefault: true,
          NOT: { id },
        },
        data: { isDefault: false },
      });
    }

    return tx.renderTemplate.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.storageUrl !== undefined && { storageUrl: input.storageUrl }),
        ...(input.hash !== undefined && { hash: input.hash }),
        ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
        ...(input.storageServiceInstanceId !== undefined && {
          storageServiceInstanceId: input.storageServiceInstanceId,
        }),
        ...(input.storageExternalId !== undefined && { storageExternalId: input.storageExternalId }),
        ...(input.storageBucket !== undefined && { storageBucket: input.storageBucket }),
        ...(input.storageContentType !== undefined && { storageContentType: input.storageContentType }),
        ...(input.inline !== undefined && { inline: input.inline }),
        ...(input.mediaType !== undefined && { mediaType: input.mediaType }),
        ...(input.mediaQuery !== undefined && { mediaQuery: input.mediaQuery }),
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
 * Returns the default render template for a tenant + dataModelId combination.
 * Prefers the tenant's own default; falls back to the system default.
 * Returns null if none is set.
 */
export async function getDefaultRenderTemplate(
  tenantId: string,
  dataModelId: string,
): Promise<RenderTemplateWithRelations | null> {
  // Tenant's own default first
  const tenantDefault = await prisma.renderTemplate.findFirst({
    where: { tenantId, dataModelId, isDefault: true },
    include: RENDER_TEMPLATE_INCLUDE,
  });
  if (tenantDefault) return tenantDefault;

  // Fall back to system default
  return prisma.renderTemplate.findFirst({
    where: { tenantId: SYSTEM_TENANT_ID, dataModelId, isDefault: true },
    include: RENDER_TEMPLATE_INCLUDE,
  });
}
