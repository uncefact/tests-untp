import { getMapper } from '@uncefact/untp-ri-services';
import type { ICredentialMapper } from '@uncefact/untp-ri-services';
import { listDataModels } from '@/lib/prisma/repositories';
import type { DataModelWithRelations } from '@/lib/prisma/repositories';
import { CredentialType } from '@/lib/prisma/generated';
import { ValidationError } from '@/lib/api/validation';

export type ResolvedDataModel = {
  dataModel: DataModelWithRelations;
  mapper: ICredentialMapper;
  schemaUrls: string[];
};

export async function resolveDataModel(
  tenantId: string,
  credentialType: string,
  version: string,
): Promise<ResolvedDataModel> {
  const { data: dataModels } = await listDataModels(tenantId, {
    credentialType: credentialType as CredentialType,
    version,
  });

  const dataModel = dataModels[0];
  if (!dataModel) {
    throw new ValidationError(`No data model found for ${credentialType} v${version}`);
  }

  const mapperType =
    dataModel.isExtension && dataModel.parentConfig ? dataModel.parentConfig.credentialType : dataModel.credentialType;
  const mapperVersion =
    dataModel.isExtension && dataModel.parentConfig ? dataModel.parentConfig.version : dataModel.version;

  const mapper = getMapper(mapperType, mapperVersion);
  if (!mapper) {
    throw new ValidationError(`No mapper registered for ${mapperType} v${mapperVersion}`);
  }

  const schemaUrls: string[] = [];
  if (dataModel.isExtension && dataModel.parentConfig) {
    schemaUrls.push(dataModel.parentConfig.schemaUrl);
  }
  schemaUrls.push(dataModel.schemaUrl);

  return { dataModel, mapper, schemaUrls };
}
