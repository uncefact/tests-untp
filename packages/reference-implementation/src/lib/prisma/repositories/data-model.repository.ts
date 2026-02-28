import { CredentialType, Prisma } from '../generated';
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

/**
 * Include shape used by all data model queries.
 * Includes the parent config, extensions, and render templates.
 */
const DATA_MODEL_INCLUDE = {
  parentConfig: true,
  extensions: true,
  renderTemplates: true,
} as const;

/**
 * A data model with its full relations.
 * Matches the include shape defined by DATA_MODEL_INCLUDE.
 */
export type DataModelWithRelations = Prisma.DataModelGetPayload<{
  include: typeof DATA_MODEL_INCLUDE;
}>;

/**
 * Input for creating a new data model.
 */
export type CreateDataModelInput = {
  name: string;
  credentialType: CredentialType;
  version: string;
  schemaUrl: string;
  contextUrl: string;
  websiteUrl?: string;
  isExtension?: boolean;
  parentConfigId?: string;
};

/**
 * Input for updating an existing data model.
 * Only name, schemaUrl, contextUrl, and websiteUrl may be changed.
 */
export type UpdateDataModelInput = {
  name?: string;
  schemaUrl?: string;
  contextUrl?: string;
  websiteUrl?: string;
};

/**
 * Options for listing data models.
 */
export type ListDataModelOptions = {
  isExtension?: boolean;
  credentialType?: CredentialType;
  version?: string;
  limit?: number;
  offset?: number;
};

/**
 * Creates a new data model scoped to a tenant.
 * If isExtension is true (the default), validates that parentConfigId is
 * provided and that the parent is a core type (isExtension=false).
 */
export async function createDataModel(tenantId: string, input: CreateDataModelInput): Promise<DataModelWithRelations> {
  const isExtension = input.isExtension ?? true;

  return prisma.$transaction(async (tx) => {
    if (isExtension) {
      if (!input.parentConfigId) {
        throw new ValidationError('parentConfigId is required for extension configs');
      }

      const parent = await tx.dataModel.findFirst({
        where: { id: input.parentConfigId },
      });

      if (!parent) {
        throw new NotFoundError('Parent config not found');
      }

      if (parent.isExtension) {
        throw new ValidationError('Parent config must be a core type (isExtension=false)');
      }
    }

    return tx.dataModel.create({
      data: {
        tenantId,
        name: input.name,
        credentialType: input.credentialType,
        version: input.version,
        schemaUrl: input.schemaUrl,
        contextUrl: input.contextUrl,
        isExtension,
        ...(input.websiteUrl !== undefined && { websiteUrl: input.websiteUrl }),
        ...(input.parentConfigId !== undefined && { parentConfigId: input.parentConfigId }),
      },
      include: DATA_MODEL_INCLUDE,
    });
  });
}

/**
 * Retrieves a data model by ID.
 * Returns models visible to the tenant OR system-provisioned.
 */
export async function getDataModelById(id: string, tenantId: string): Promise<DataModelWithRelations | null> {
  return prisma.dataModel.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
    },
    include: DATA_MODEL_INCLUDE,
  });
}

/**
 * Lists data models for a tenant, including system-provisioned configs.
 * Supports filtering by isExtension, credentialType, and version.
 */
export async function listDataModels(
  tenantId: string,
  options: ListDataModelOptions = {},
): Promise<DataModelWithRelations[]> {
  const { isExtension, credentialType, version, limit, offset } = options;

  const where: Prisma.DataModelWhereInput = {
    OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
  };

  if (isExtension !== undefined) {
    where.isExtension = isExtension;
  }

  if (credentialType !== undefined) {
    where.credentialType = credentialType;
  }

  if (version !== undefined) {
    where.version = version;
  }

  return prisma.dataModel.findMany({
    where,
    include: DATA_MODEL_INCLUDE,
    take: limit ?? 100,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Updates a data model.
 * Only tenant-owned extension configs can be updated.
 * System-provisioned and core configs are immutable from the tenant's perspective.
 */
export async function updateDataModel(
  id: string,
  tenantId: string,
  input: UpdateDataModelInput,
): Promise<DataModelWithRelations> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.dataModel.findFirst({
      where: { id, tenantId, isExtension: true },
    });

    if (!existing) {
      throw new NotFoundError('Data model not found or access denied');
    }

    return tx.dataModel.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.schemaUrl !== undefined && { schemaUrl: input.schemaUrl }),
        ...(input.contextUrl !== undefined && { contextUrl: input.contextUrl }),
        ...(input.websiteUrl !== undefined && { websiteUrl: input.websiteUrl }),
      },
      include: DATA_MODEL_INCLUDE,
    });
  });
}

/**
 * Deletes a data model.
 * Only tenant-owned extension configs can be deleted.
 * System-provisioned and core configs cannot be removed by tenants.
 */
export async function deleteDataModel(id: string, tenantId: string): Promise<DataModelWithRelations> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.dataModel.findFirst({
      where: { id, tenantId, isExtension: true },
    });

    if (!existing) {
      throw new NotFoundError('Data model not found or access denied');
    }

    return tx.dataModel.delete({
      where: { id },
      include: DATA_MODEL_INCLUDE,
    });
  });
}
