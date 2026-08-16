import { Prisma } from '../generated';
import { prisma } from '../prisma';
import { SYSTEM_TENANT_ID } from '../constants';
import { NotFoundError } from '@/lib/api/errors';
import { isForeignKeyViolationOn, mapDatabaseError } from '@/lib/prisma/db-errors';
import { ValidationError } from '@/lib/api/validation';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

/**
 * Include shape for single data model queries (getById, create, update).
 * Includes extensions and render templates for full detail.
 */
const DATA_MODEL_DETAIL_INCLUDE = {
  parentConfig: true,
  extensions: true,
  renderTemplates: true,
} as const;

/**
 * Include shape for list queries.
 * Includes parentConfig for internal use (e.g. credential issuance resolution).
 * Omits extensions and renderTemplates to keep list responses lean.
 * The API route strips parentConfig from the response before returning to clients.
 */
const DATA_MODEL_LIST_INCLUDE = {
  parentConfig: true,
} as const;

/**
 * A data model with its full relations (extensions + render templates).
 * Used for single-record responses (getById, create, update).
 */
export type DataModelWithRelations = Prisma.DataModelGetPayload<{
  include: typeof DATA_MODEL_DETAIL_INCLUDE;
}>;

/**
 * A data model with the parent config relation.
 * Used for list responses and internal resolution.
 */
export type DataModelListItem = Prisma.DataModelGetPayload<{
  include: typeof DATA_MODEL_LIST_INCLUDE;
}>;

/**
 * Input for creating a new data model.
 */
export type CreateDataModelInput = {
  name: string;
  credentialType: string;
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
  credentialType?: string;
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

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    if (isExtension) {
      if (!input.parentConfigId) {
        throw new ValidationError('parentConfigId is required for extension configs');
      }

      // Scoped to what the tenant can see, matching getDataModelById and
      // listDataModels: a core model belonging to another tenant is not a
      // valid parent, and an unscoped lookup would accept and store the
      // reference. A parent outside that set is reported as not found rather
      // than as forbidden, so the response does not confirm that another
      // tenant holds a model with this id.
      const parent = await tx.dataModel.findFirst({
        where: {
          id: input.parentConfigId,
          OR: [{ tenantId }, { tenantId: SYSTEM_TENANT_ID }],
        },
      });

      if (!parent) {
        throw new NotFoundError('Parent data model configuration not found');
      }

      if (parent.isExtension) {
        throw new ValidationError('Parent data model configuration must be a core data model');
      }
    }

    try {
      return await tx.dataModel.create({
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
        include: DATA_MODEL_DETAIL_INCLUDE,
      });
    } catch (e) {
      // A parentConfigId violation means the parent vanished after the
      // pre-check above; it surfaces as that pre-check's 404.
      if (isForeignKeyViolationOn(e, 'parentConfigId')) {
        throw new NotFoundError('Parent data model configuration not found');
      }
      mapDatabaseError(e, {
        conflict: 'A data model with this name already exists for the credential type and version',
      });
    }
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
    include: DATA_MODEL_DETAIL_INCLUDE,
  });
}

/**
 * Lists data models for a tenant, including system-provisioned configs.
 * Supports filtering by isExtension, credentialType, and version.
 * Returns lean items without extensions or renderTemplates.
 */
export async function listDataModels(
  tenantId: string,
  options: ListDataModelOptions = {},
): Promise<{ data: DataModelListItem[]; total: number }> {
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

  const [data, total] = await prisma.$transaction([
    prisma.dataModel.findMany({
      where,
      include: DATA_MODEL_LIST_INCLUDE,
      take: limit ?? DEFAULT_PAGE_LIMIT,
      skip: offset,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.dataModel.count({ where }),
  ]);

  return { data, total };
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
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.dataModel.findFirst({
      where: { id, tenantId, isExtension: true },
    });

    if (!existing) {
      throw new NotFoundError('Data model not found');
    }

    try {
      return await tx.dataModel.update({
        where: { id },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.schemaUrl !== undefined && { schemaUrl: input.schemaUrl }),
          ...(input.contextUrl !== undefined && { contextUrl: input.contextUrl }),
          ...(input.websiteUrl !== undefined && { websiteUrl: input.websiteUrl }),
        },
        include: DATA_MODEL_DETAIL_INCLUDE,
      });
    } catch (e) {
      mapDatabaseError(e, {
        conflict: 'A data model with this name already exists for the credential type and version',
        notFound: 'Data model not found',
      });
    }
  });
}

/**
 * Deletes a data model.
 * Only tenant-owned extension configs can be deleted.
 * System-provisioned and core configs cannot be removed by tenants.
 */
export async function deleteDataModel(id: string, tenantId: string): Promise<void> {
  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.dataModel.findFirst({
      where: { id, tenantId, isExtension: true },
    });

    if (!existing) {
      throw new NotFoundError('Data model not found');
    }

    try {
      await tx.dataModel.delete({ where: { id } });
    } catch (e) {
      mapDatabaseError(e, { notFound: 'Data model not found' });
    }
  });
}
