import { getBridge } from '@uncefact/untp-ri-services';
import type { IDataModelBridge } from '@uncefact/untp-ri-services';
import { listDataModels } from '@/lib/prisma/repositories';
import type { DataModelListItem } from '@/lib/prisma/repositories';
import { ValidationError } from '@/lib/api/validation';

export type ResolvedDataModel = {
  dataModel: DataModelListItem;
  bridge: IDataModelBridge;
  schemaUrls: string[];
  /**
   * Spec version `bridge` was resolved with. For an extension this is the
   * parent data model's version, not the extension's own version, because
   * that is the key the registry uses.
   */
  coreDataModelVersion: string;
};

export function isDccDataModel(dataModel: DataModelListItem): boolean {
  return (
    dataModel.credentialType === 'DigitalConformityCredential' ||
    (dataModel.isExtension === true && dataModel.parentConfig?.credentialType === 'DigitalConformityCredential')
  );
}

export async function resolveDataModel(
  tenantId: string,
  credentialType: string,
  version: string,
): Promise<ResolvedDataModel> {
  const { data: dataModels } = await listDataModels(tenantId, {
    credentialType,
    version,
  });

  const dataModel = dataModels[0];
  if (!dataModel) {
    throw new ValidationError(`No data model found for ${credentialType} v${version}`);
  }

  const dataModelType =
    dataModel.isExtension && dataModel.parentConfig ? dataModel.parentConfig.credentialType : dataModel.credentialType;
  const coreDataModelVersion =
    dataModel.isExtension && dataModel.parentConfig ? dataModel.parentConfig.version : dataModel.version;

  const bridge = getBridge(dataModelType, coreDataModelVersion);
  if (!bridge) {
    throw new ValidationError(`No bridge registered for ${dataModelType} v${coreDataModelVersion}`);
  }

  const schemaUrls: string[] = [];
  if (dataModel.isExtension && dataModel.parentConfig) {
    schemaUrls.push(dataModel.parentConfig.schemaUrl);
  }
  schemaUrls.push(dataModel.schemaUrl);

  return { dataModel, bridge, schemaUrls, coreDataModelVersion };
}
