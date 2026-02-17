import { CredentialType, Prisma } from '../generated';
import { prisma } from '../prisma';
import { NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

/**
 * Include shape used by all credential type config queries.
 * Includes the parent config, extensions, and render templates.
 */
const CREDENTIAL_TYPE_CONFIG_INCLUDE = {
  parentConfig: true,
  extensions: true,
  renderTemplates: true,
} as const;

/**
 * A credential type config with its full relations.
 * Matches the include shape defined by CREDENTIAL_TYPE_CONFIG_INCLUDE.
 */
export type CredentialTypeConfigWithRelations = Prisma.CredentialTypeConfigGetPayload<{
  include: typeof CREDENTIAL_TYPE_CONFIG_INCLUDE;
}>;

/**
 * Input for creating a new credential type config.
 */
export type CreateCredentialTypeConfigInput = {
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
 * Input for updating an existing credential type config.
 * Only name, schemaUrl, contextUrl, and websiteUrl may be changed.
 */
export type UpdateCredentialTypeConfigInput = {
  name?: string;
  schemaUrl?: string;
  contextUrl?: string;
  websiteUrl?: string;
};

/**
 * Options for listing credential type configs.
 */
export type ListCredentialTypeConfigOptions = {
  isExtension?: boolean;
  credentialType?: CredentialType;
  version?: string;
  limit?: number;
  offset?: number;
};

/**
 * Creates a new credential type config scoped to a tenant.
 * If isExtension is true (the default), validates that parentConfigId is
 * provided and that the parent is a core type (isExtension=false).
 */
export async function createCredentialTypeConfig(
  tenantId: string,
  input: CreateCredentialTypeConfigInput,
): Promise<CredentialTypeConfigWithRelations> {
  const isExtension = input.isExtension ?? true;

  return prisma.$transaction(async (tx) => {
    if (isExtension) {
      if (!input.parentConfigId) {
        throw new ValidationError('parentConfigId is required for extension configs');
      }

      const parent = await tx.credentialTypeConfig.findFirst({
        where: { id: input.parentConfigId },
      });

      if (!parent) {
        throw new NotFoundError('Parent config not found');
      }

      if (parent.isExtension) {
        throw new ValidationError('Parent config must be a core type (isExtension=false)');
      }
    }

    return tx.credentialTypeConfig.create({
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
      include: CREDENTIAL_TYPE_CONFIG_INCLUDE,
    });
  });
}

/**
 * Retrieves a credential type config by ID.
 * Returns configs visible to the tenant OR system-provisioned (tenantId=null).
 */
export async function getCredentialTypeConfigById(
  id: string,
  tenantId: string,
): Promise<CredentialTypeConfigWithRelations | null> {
  return prisma.credentialTypeConfig.findFirst({
    where: {
      id,
      OR: [{ tenantId }, { tenantId: null }],
    },
    include: CREDENTIAL_TYPE_CONFIG_INCLUDE,
  });
}

/**
 * Lists credential type configs for a tenant, including system-provisioned configs.
 * Supports filtering by isExtension, credentialType, and version.
 */
export async function listCredentialTypeConfigs(
  tenantId: string,
  options: ListCredentialTypeConfigOptions = {},
): Promise<CredentialTypeConfigWithRelations[]> {
  const { isExtension, credentialType, version, limit, offset } = options;

  const where: Prisma.CredentialTypeConfigWhereInput = {
    OR: [{ tenantId }, { tenantId: null }],
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

  return prisma.credentialTypeConfig.findMany({
    where,
    include: CREDENTIAL_TYPE_CONFIG_INCLUDE,
    take: limit ?? 100,
    skip: offset,
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Updates a credential type config.
 * Only tenant-owned extension configs can be updated.
 * System-provisioned and core configs are immutable from the tenant's perspective.
 */
export async function updateCredentialTypeConfig(
  id: string,
  tenantId: string,
  input: UpdateCredentialTypeConfigInput,
): Promise<CredentialTypeConfigWithRelations> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.credentialTypeConfig.findFirst({
      where: { id, tenantId, isExtension: true },
    });

    if (!existing) {
      throw new NotFoundError('Credential type config not found or access denied');
    }

    return tx.credentialTypeConfig.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.schemaUrl !== undefined && { schemaUrl: input.schemaUrl }),
        ...(input.contextUrl !== undefined && { contextUrl: input.contextUrl }),
        ...(input.websiteUrl !== undefined && { websiteUrl: input.websiteUrl }),
      },
      include: CREDENTIAL_TYPE_CONFIG_INCLUDE,
    });
  });
}

/**
 * Deletes a credential type config.
 * Only tenant-owned extension configs can be deleted.
 * System-provisioned and core configs cannot be removed by tenants.
 */
export async function deleteCredentialTypeConfig(
  id: string,
  tenantId: string,
): Promise<CredentialTypeConfigWithRelations> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.credentialTypeConfig.findFirst({
      where: { id, tenantId, isExtension: true },
    });

    if (!existing) {
      throw new NotFoundError('Credential type config not found or access denied');
    }

    return tx.credentialTypeConfig.delete({
      where: { id },
      include: CREDENTIAL_TYPE_CONFIG_INCLUDE,
    });
  });
}
